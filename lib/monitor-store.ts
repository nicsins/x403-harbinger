/**
 * Durable pending-monitor and hook outbox.
 *
 * Grant counters stay in grant-store.ts. This store commits them in the same
 * critical section as the monitor row:
 * - create reserves one unit only when it actually inserts a new tx monitor
 *   (CREATE_LUA on Upstash, the create lock in memory). A rejected insert
 *   (pending, fired, or past the rearm cap) does not reserve.
 * - fire converts that hold into a spend inside FIRE_LUA / the commit lock.
 *   The convert does not re-check `used + reserved < quota`.
 * - no-move, including a deadline reached by stepTrigger or the pump, releases
 *   the hold. `used` does not change.
 *
 * Chosen over reserve-then-create: a crash between the two calls, or a create
 * that loses the race, would hold a unit with no monitor or free a unit the
 * winner still needs. One script (or one lock section) commits both.
 * Demo monitors (`grantKey === "demo"`) skip the counter. A replayed commit
 * is idempotent per monitor id (`reservation` on the binding).
 *
 * Production with no Upstash credentials and no GRANT_STORE=memory returns null.
 * Callers fail closed.
 */
import { createHash } from "node:crypto";
import type { PriceSample } from "@/lib/trigger";
import { storeKeys, type StoreKeys } from "@/lib/store-keys";
import {
  GRANT_LUA_LIB,
  grantStoreFromEnv,
  normalizeBinding,
  type GrantBinding,
  type GrantOpReason,
  type MemoryGrantStore,
} from "@/lib/grant-store";


export type HookState = "armed" | "queued" | "inflight" | "delivered" | "skipped" | "dead";

export type HookDelivery = {
  url: string;
  state: HookState;
  attempts: number;
  lockedUntil: number;
  lastError?: string;
};

export type GrantSnap = { watchId: string; used: number; quota: number; expiresAt: number; reserved?: number };

export type CreateOutcome =
  | { ok: true; monitor: Monitor }
  | { ok: false; reason: GrantOpReason; binding?: GrantBinding };

export type MonitorStatus = "pending" | "fired" | "no-move" | "closed";

export type Monitor = {
  id: string;
  version: number;
  generation: number;
  /** tx hash, or "demo". */
  grantKey: string;
  /** Bearer presented at arm time. Server-side only; never copy onto a ping. */
  grantRaw: string;
  watchId: string;
  status: MonitorStatus;
  startedAt: number;
  deadlineAt: number;
  baseline: PriceSample | null;
  samples: PriceSample[];
  firedAt: number | null;
  correlation: number | null;
  correlationNote: string | null;
  receipt: string | null;
  ping: Record<string, unknown> | null;
  deliveryBody: string | null;
  consumed: boolean;
  closedReason?: string;
  hook?: HookDelivery;
  grant?: GrantSnap;
};

export type CommitOp = "save" | "fire" | "nomove" | "attach" | "close";

export type FinishResult =
  | { ok: true; applied: boolean; monitor: Monitor }
  | { ok: false; reason: "conflict" | "missing" | "exhausted" | "expired" | "unbound" | "unavailable"; monitor?: Monitor };

export function monitorId(grantKey: string, watchId: string, generation: number): string {
  const hex = createHash("sha256").update(`${grantKey}:${watchId}:${generation}`).digest("hex").slice(0, 20);
  return `mon_${hex}`;
}

export interface MonitorStore {
  readonly kind: "memory" | "upstash";
  get(id: string): Promise<Monitor | null>;
  find(grantKey: string, watchId: string): Promise<Monitor | null>;
  /**
   * Insert, or return the monitor the create guard keeps.
   * `reserve: true` holds one quota unit in the same critical section as the
   * insert. Demo callers omit it. A kept row does not reserve again.
   */
  create(monitor: Monitor, opts?: { reserve?: boolean }): Promise<CreateOutcome>;
  /**
   * Write `next` if `expectedVersion` still matches and the monitor is pending.
   * `fire` converts the monitor's reservation into a spend. `nomove` releases
   * it. Both happen inside the lock (memory) or FIRE_LUA (Upstash), keyed by
   * monitor id, so a replay cannot spend or release twice.
   */
  commit(opts: {
    expectedVersion: number;
    next: Monitor;
    op: CommitOp;
    now: number;
  }): Promise<FinishResult>;
  listPending(): Promise<Monitor[]>;
  listOutbox(now: number): Promise<Monitor[]>;
  claimDelivery(id: string, now: number, lockMs?: number): Promise<Monitor | null>;
  settleDelivery(id: string, result: { ok: boolean; error?: string }, maxAttempts: number): Promise<Monitor | null>;
}

function indexKey(grantKey: string, watchId: string): string {
  return `${grantKey}:${watchId}`;
}

function patchFired(next: Monitor, grant: GrantSnap | undefined, demo: boolean): Monitor {
  const ping = next.ping ? { ...next.ping } : null;
  if (ping && grant) {
    const prev = (ping.grant ?? {}) as Record<string, unknown>;
    ping.grant = {
      ...prev,
      watchId: grant.watchId,
      used: grant.used,
      quota: grant.quota,
      reserved: grant.reserved ?? 0,
      expiresAt: new Date(grant.expiresAt).toISOString(),
    };
  }
  return {
    ...next,
    ping,
    grant: grant ?? next.grant,
    consumed: !demo && Boolean(grant),
    deliveryBody: ping ? JSON.stringify(ping) : next.deliveryBody,
  };
}

/** Free re-arms after a no-move allowed per tx grant. */
export const REARM_LIMIT = 3;
/** Generation 1 is the first arm; each later generation is one free re-arm. */
export const MAX_GENERATION = 1 + REARM_LIMIT;

function memoryGrants(): MemoryGrantStore | null {
  const gs = grantStoreFromEnv();
  return gs?.kind === "memory" ? (gs as MemoryGrantStore) : null;
}

/**
 * Store-side create guard (mirrored in CREATE_LUA, atomic on Upstash).
 * Returns the monitor to keep, or null to write `incoming`.
 * A new generation may only follow a no-move, and a tx grant stops at
 * MAX_GENERATION. The shared demo monitor is not capped.
 */
function acceptCreate(prev: Monitor | null, incoming: Monitor): Monitor | null {
  if (!prev) return null;
  if (prev.status === "pending") return prev;
  if (prev.generation >= incoming.generation) return prev;
  if (prev.status !== "no-move") return prev;
  if (incoming.grantKey !== "demo" && incoming.generation > MAX_GENERATION) return prev;
  return null;
}

export class MemoryMonitorStore implements MonitorStore {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, Monitor>();
  private readonly index = new Map<string, { id: string; generation: number }>();
  private readonly pending = new Set<string>();
  private readonly outbox = new Set<string>();
  private readonly tails = new Map<string, Promise<unknown>>();

  private lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.tails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async get(id: string): Promise<Monitor | null> {
    const m = this.map.get(id);
    return m ? structuredClone(m) : null;
  }

  async find(grantKey: string, watchId: string): Promise<Monitor | null> {
    const idx = this.index.get(indexKey(grantKey, watchId));
    if (!idx) return null;
    return this.get(idx.id);
  }

  async create(monitor: Monitor, opts?: { reserve?: boolean }): Promise<CreateOutcome> {
    const key = indexKey(monitor.grantKey, monitor.watchId);
    return this.lock(`idx:${key}`, async () => {
      const idx = this.index.get(key);
      const prev = idx ? (this.map.get(idx.id) ?? null) : null;
      const keep = acceptCreate(prev, monitor);
      if (keep) return { ok: true as const, monitor: structuredClone(keep) };
      if (opts?.reserve && monitor.grantKey !== "demo") {
        const grants = memoryGrants();
        if (!grants) return { ok: false as const, reason: "unavailable" as const };
        const held = grants.reserveNow(monitor.grantKey, monitor.id, monitor.watchId, monitor.startedAt);
        if (!held.ok) return { ok: false as const, reason: held.reason, ...(held.binding ? { binding: held.binding } : {}) };
      }
      const stored = structuredClone(monitor);
      this.map.set(stored.id, stored);
      this.index.set(key, { id: stored.id, generation: stored.generation });
      if (stored.status === "pending") this.pending.add(stored.id);
      return { ok: true as const, monitor: structuredClone(stored) };
    });
  }

  private track(m: Monitor) {
    if (m.status === "pending") this.pending.add(m.id);
    else this.pending.delete(m.id);
    if (m.hook?.state === "queued" || m.hook?.state === "inflight") this.outbox.add(m.id);
    else this.outbox.delete(m.id);
  }

  async commit(opts: { expectedVersion: number; next: Monitor; op: CommitOp; now: number }): Promise<FinishResult> {
    return this.lock(`mon:${opts.next.id}`, async () => {
      const current = this.map.get(opts.next.id);
      if (!current) return { ok: false, reason: "missing" };
      if (current.status !== "pending") return { ok: true, applied: false, monitor: structuredClone(current) };
      if (current.version !== opts.expectedVersion) return { ok: false, reason: "conflict", monitor: structuredClone(current) };

      let next: Monitor = structuredClone({ ...opts.next, version: current.version + 1 });
      if (opts.op === "fire") {
        if (current.grantKey === "demo") {
          next = patchFired(next, undefined, true);
        } else {
          const grants = memoryGrants();
          if (!grants) return { ok: false, reason: "unavailable", monitor: structuredClone(current) };
          const spent = grants.convertNow(current.grantKey, current.id, opts.now);
          if (!spent.ok) {
            if (spent.reason === "unavailable") return { ok: false, reason: "unavailable", monitor: structuredClone(current) };
            const closed: Monitor = {
              ...current,
              version: current.version + 1,
              status: "closed",
              closedReason: spent.reason,
              consumed: false,
            };
            this.map.set(closed.id, closed);
            this.track(closed);
            return { ok: false, reason: spent.reason, monitor: structuredClone(closed) };
          }
          next = patchFired(
            next,
            {
              watchId: spent.binding.watchId,
              used: spent.binding.used,
              quota: spent.binding.quota,
              expiresAt: spent.binding.expiresAt,
              reserved: spent.binding.reserved ?? 0,
            },
            false,
          );
        }
      } else if (opts.op === "nomove" && current.grantKey !== "demo") {
        memoryGrants()?.releaseNow(current.grantKey, current.id);
      }
      this.map.set(next.id, next);
      this.track(next);
      return { ok: true, applied: true, monitor: structuredClone(next) };
    });
  }

  async listPending(): Promise<Monitor[]> {
    const out: Monitor[] = [];
    for (const id of this.pending) {
      const m = this.map.get(id);
      if (m && m.status === "pending") out.push(structuredClone(m));
    }
    return out;
  }

  async listOutbox(now: number): Promise<Monitor[]> {
    const out: Monitor[] = [];
    for (const id of this.outbox) {
      const m = this.map.get(id);
      if (!m?.hook) continue;
      if (m.hook.state === "queued") out.push(structuredClone(m));
      else if (m.hook.state === "inflight" && m.hook.lockedUntil <= now) out.push(structuredClone(m));
    }
    return out;
  }

  async claimDelivery(id: string, now: number, lockMs = 60_000): Promise<Monitor | null> {
    return this.lock(`mon:${id}`, async () => {
      const m = this.map.get(id);
      if (!m?.hook || !m.deliveryBody) return null;
      const state = m.hook.state;
      if (state === "delivered" || state === "skipped" || state === "dead" || state === "armed") return null;
      if (state === "inflight" && m.hook.lockedUntil > now) return null;
      if (state !== "queued" && state !== "inflight") return null;
      const next: Monitor = {
        ...m,
        version: m.version + 1,
        hook: { ...m.hook, state: "inflight", attempts: m.hook.attempts + 1, lockedUntil: now + lockMs },
      };
      this.map.set(id, next);
      this.track(next);
      return structuredClone(next);
    });
  }

  async settleDelivery(id: string, result: { ok: boolean; error?: string }, maxAttempts: number): Promise<Monitor | null> {
    return this.lock(`mon:${id}`, async () => {
      const m = this.map.get(id);
      if (!m?.hook || m.hook.state !== "inflight") return m ? structuredClone(m) : null;
      const failed = !result.ok;
      const dead = failed && m.hook.attempts >= maxAttempts;
      const state: HookState = result.ok ? "delivered" : dead ? "dead" : "queued";
      const next: Monitor = {
        ...m,
        version: m.version + 1,
        hook: {
          ...m.hook,
          state,
          lockedUntil: 0,
          ...(result.error ? { lastError: result.error } : {}),
        },
      };
      this.map.set(id, next);
      this.track(next);
      return structuredClone(next);
    });
  }
}

export const FIRE_LUA = `-- harbinger-op:commit
${GRANT_LUA_LIB}
local function reply(obj)
  return cjson.encode(obj)
end
local raw = redis.call('GET', KEYS[1])
if not raw or raw == '' then return reply({ok=false, reason='missing'}) end
local cur = cjson.decode(raw)
local op = ARGV[1]
local expected = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
if cur.status ~= 'pending' then return reply({ok=true, applied=false, monitor=cur}) end
if tonumber(cur.version) ~= expected then return reply({ok=false, reason='conflict', monitor=cur}) end
local nxt = cjson.decode(ARGV[4])
if op == 'fire' and KEYS[4] and KEYS[4] ~= '' then
  local graw = redis.call('GET', KEYS[4])
  if not graw or graw == '' then return reply({ok=false, reason='unbound', monitor=cur}) end
  local b = cjson.decode(graw)
  local why = h_convert(b, cur.id, now)
  redis.call('SET', KEYS[4], cjson.encode(b))
  if why then
    cur.status = 'closed'
    cur.closedReason = why
    cur.consumed = false
    cur.version = tonumber(cur.version) + 1
    redis.call('SET', KEYS[1], cjson.encode(cur))
    redis.call('SREM', KEYS[2], cur.id)
    return reply({ok=false, reason=why, monitor=cur})
  end
  nxt.consumed = true
  nxt.grant = { watchId = b.watchId, used = b.used, quota = tonumber(b.quota), reserved = tonumber(b.reserved) or 0, expiresAt = tonumber(b.expiresAt) }
  if nxt.ping and nxt.ping.grant then
    nxt.ping.grant.used = b.used
    nxt.ping.grant.quota = tonumber(b.quota)
    nxt.ping.grant.reserved = tonumber(b.reserved) or 0
  end
  if nxt.ping then nxt.deliveryBody = cjson.encode(nxt.ping) end
elseif op == 'nomove' and KEYS[4] and KEYS[4] ~= '' then
  local graw = redis.call('GET', KEYS[4])
  if graw and graw ~= '' then
    local b = cjson.decode(graw)
    h_release(b, cur.id)
    redis.call('SET', KEYS[4], cjson.encode(b))
  end
elseif op == 'fire' and nxt.ping and (not nxt.deliveryBody or nxt.deliveryBody == cjson.null) then
  nxt.deliveryBody = cjson.encode(nxt.ping)
end
nxt.version = tonumber(cur.version) + 1
redis.call('SET', KEYS[1], cjson.encode(nxt))
if nxt.status ~= 'pending' then redis.call('SREM', KEYS[2], nxt.id) end
if nxt.hook and nxt.hook.state == 'queued' then redis.call('SADD', KEYS[3], nxt.id)
elseif nxt.hook then redis.call('SREM', KEYS[3], nxt.id) end
return reply({ok=true, applied=true, monitor=nxt})
`;

export const CREATE_LUA = `-- harbinger-op:create
${GRANT_LUA_LIB}
local existing = redis.call('GET', KEYS[1])
if existing and existing ~= '' then
  local idx = cjson.decode(existing)
  local raw = redis.call('GET', ARGV[1] .. idx.id)
  if raw and raw ~= '' then
    local prev = cjson.decode(raw)
    local incoming = cjson.decode(ARGV[3])
    if prev.status == 'pending' or tonumber(idx.generation) >= tonumber(incoming.generation) then
      return raw
    end
    if prev.status ~= 'no-move' then return raw end
    if incoming.grantKey ~= 'demo' and tonumber(incoming.generation) > tonumber(ARGV[4]) then return raw end
  end
end
local incoming = cjson.decode(ARGV[3])
if KEYS[4] and KEYS[4] ~= '' then
  local graw = redis.call('GET', KEYS[4])
  if not graw or graw == '' then
    return cjson.encode({__harbinger='reserve-failed', reason='unbound'})
  end
  local b = cjson.decode(graw)
  local why = h_reserve(b, incoming.id, incoming.watchId, tonumber(incoming.startedAt) or 0)
  if why then
    return cjson.encode({__harbinger='reserve-failed', reason=why, binding=b})
  end
  redis.call('SET', KEYS[4], cjson.encode(b))
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
if incoming.status == 'pending' then redis.call('SADD', KEYS[3], incoming.id) end
return ARGV[3]
`;

const CLAIM_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw or raw == '' then return '' end
local m = cjson.decode(raw)
if not m.hook or not m.deliveryBody or m.deliveryBody == cjson.null then return '' end
local state = m.hook.state
if state == 'delivered' or state == 'skipped' or state == 'dead' or state == 'armed' then return '' end
local now = tonumber(ARGV[1])
local lockMs = tonumber(ARGV[2])
if state == 'inflight' and tonumber(m.hook.lockedUntil) > now then return '' end
if state ~= 'queued' and state ~= 'inflight' then return '' end
m.hook.state = 'inflight'
m.hook.attempts = tonumber(m.hook.attempts or 0) + 1
m.hook.lockedUntil = now + lockMs
m.version = tonumber(m.version) + 1
local encoded = cjson.encode(m)
redis.call('SET', KEYS[1], encoded)
return encoded
`;

const SETTLE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw or raw == '' then return '' end
local m = cjson.decode(raw)
if not m.hook or m.hook.state ~= 'inflight' then return raw end
local ok = ARGV[1] == '1'
local maxAttempts = tonumber(ARGV[2])
local err = ARGV[3]
if ok then
  m.hook.state = 'delivered'
  m.hook.lockedUntil = 0
elseif tonumber(m.hook.attempts) >= maxAttempts then
  m.hook.state = 'dead'
  m.hook.lockedUntil = 0
  if err ~= '' then m.hook.lastError = err end
else
  m.hook.state = 'queued'
  m.hook.lockedUntil = 0
  if err ~= '' then m.hook.lastError = err end
end
m.version = tonumber(m.version) + 1
local encoded = cjson.encode(m)
redis.call('SET', KEYS[1], encoded)
if m.hook.state ~= 'queued' and m.hook.state ~= 'inflight' then redis.call('SREM', KEYS[2], m.id) end
return encoded
`;

type Env = Record<string, string | undefined>;

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Redis Lua cjson re-encodes an empty array as {}. Restore the array fields a script rewrote. */
export function fromLua(m: Monitor): Monitor {
  m.samples = asList(m.samples) as Monitor["samples"];
  const ping = m.ping as Record<string, unknown> | null;
  if (ping) for (const k of ["legs", "conditions", "delivery"]) if (k in ping) ping[k] = asList(ping[k]);
  return m;
}

export class UpstashMonitorStore implements MonitorStore {
  readonly kind = "upstash" as const;
  constructor(
    private readonly url: string,
    private readonly token: string,
    readonly keys: StoreKeys = storeKeys(),
  ) {}

  private async cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args.map(String)),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`monitor store HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error(`monitor store error: ${json.error}`);
    return json.result ?? null;
  }

  private parse(raw: unknown): Monitor | null {
    if (typeof raw !== "string" || raw === "") return null;
    return fromLua(JSON.parse(raw) as Monitor);
  }

  async get(id: string): Promise<Monitor | null> {
    return this.parse(await this.cmd(["GET", this.keys.monitor + id]));
  }

  async find(grantKey: string, watchId: string): Promise<Monitor | null> {
    const idxRaw = await this.cmd(["GET", this.keys.index + indexKey(grantKey, watchId)]);
    if (typeof idxRaw !== "string" || !idxRaw) return null;
    const idx = JSON.parse(idxRaw) as { id: string };
    return this.get(idx.id);
  }

  async create(monitor: Monitor, opts?: { reserve?: boolean }): Promise<CreateOutcome> {
    const keys = [
      this.keys.index + indexKey(monitor.grantKey, monitor.watchId),
      this.keys.monitor + monitor.id,
      this.keys.pending,
    ];
    if (opts?.reserve && monitor.grantKey !== "demo") keys.push(this.keys.grant + monitor.grantKey.toLowerCase());
    const raw = await this.cmd([
      "EVAL",
      CREATE_LUA,
      keys.length,
      ...keys,
      this.keys.monitor,
      JSON.stringify({ id: monitor.id, generation: monitor.generation }),
      JSON.stringify(monitor),
      MAX_GENERATION,
    ]);
    return this.readCreate(raw);
  }

  private readCreate(raw: unknown): CreateOutcome {
    if (typeof raw !== "string" || raw === "") return { ok: false, reason: "unbound" };
    const value = JSON.parse(raw) as { __harbinger?: string; reason?: GrantOpReason; binding?: GrantBinding } & Monitor;
    if (value.__harbinger === "reserve-failed") {
      return {
        ok: false,
        reason: value.reason ?? "unbound",
        ...(value.binding ? { binding: normalizeBinding(value.binding) } : {}),
      };
    }
    return { ok: true, monitor: fromLua(value) };
  }

  async commit(opts: { expectedVersion: number; next: Monitor; op: CommitOp; now: number }): Promise<FinishResult> {
    const keys = [this.keys.monitor + opts.next.id, this.keys.pending, this.keys.outbox];
    if ((opts.op === "fire" || opts.op === "nomove") && opts.next.grantKey !== "demo") {
      keys.push(this.keys.grant + opts.next.grantKey.toLowerCase());
    }
    const raw = await this.cmd([
      "EVAL",
      FIRE_LUA,
      keys.length,
      ...keys,
      opts.op,
      opts.expectedVersion,
      opts.now,
      JSON.stringify(opts.next),
    ]);
    if (typeof raw !== "string") throw new Error("monitor store: bad EVAL result");
    const parsed = JSON.parse(raw) as { ok: boolean; applied?: boolean; reason?: FinishResult extends { reason: infer R } ? R : string; monitor?: Monitor };
    if (parsed.monitor) parsed.monitor = fromLua(parsed.monitor);
    if (parsed.ok && parsed.monitor) return { ok: true, applied: Boolean(parsed.applied), monitor: parsed.monitor };
    const reason = (parsed.reason ?? "missing") as "conflict" | "missing" | "exhausted" | "expired" | "unbound" | "unavailable";
    return { ok: false, reason, ...(parsed.monitor ? { monitor: parsed.monitor } : {}) };
  }

  async listPending(): Promise<Monitor[]> {
    const ids = await this.cmd(["SMEMBERS", this.keys.pending]);
    if (!Array.isArray(ids)) return [];
    const out: Monitor[] = [];
    for (const id of ids) {
      if (typeof id !== "string") continue;
      const m = await this.get(id);
      if (m?.status === "pending") out.push(m);
    }
    return out;
  }

  async listOutbox(now: number): Promise<Monitor[]> {
    const ids = await this.cmd(["SMEMBERS", this.keys.outbox]);
    if (!Array.isArray(ids)) return [];
    const out: Monitor[] = [];
    for (const id of ids) {
      if (typeof id !== "string") continue;
      const m = await this.get(id);
      if (!m?.hook) continue;
      if (m.hook.state === "queued" || (m.hook.state === "inflight" && m.hook.lockedUntil <= now)) out.push(m);
    }
    return out;
  }

  async claimDelivery(id: string, now: number, lockMs = 60_000): Promise<Monitor | null> {
    const raw = await this.cmd(["EVAL", CLAIM_LUA, 1, this.keys.monitor + id, now, lockMs]);
    return this.parse(raw);
  }

  async settleDelivery(id: string, result: { ok: boolean; error?: string }, maxAttempts: number): Promise<Monitor | null> {
    const raw = await this.cmd([
      "EVAL",
      SETTLE_LUA,
      2,
      this.keys.monitor + id,
      this.keys.outbox,
      result.ok ? "1" : "0",
      maxAttempts,
      result.error ?? "",
    ]);
    return this.parse(raw);
  }
}

export function monitorStoreFromEnv(env: Env = process.env): MonitorStore | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashMonitorStore(url, token, storeKeys(env));
  if (env.VERCEL_ENV === "production" && env.GRANT_STORE !== "memory") return null;
  return sharedMemoryMonitor();
}

const g = globalThis as unknown as { __harbingerMonitorStore?: MemoryMonitorStore };

export function sharedMemoryMonitor(): MemoryMonitorStore {
  if (!g.__harbingerMonitorStore) g.__harbingerMonitorStore = new MemoryMonitorStore();
  return g.__harbingerMonitorStore;
}

export function resetSharedMonitor(): void {
  g.__harbingerMonitorStore = undefined;
}
