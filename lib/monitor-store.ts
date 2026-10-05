/**
 * Durable pending-monitor and hook outbox.
 *
 * Grant redemption itself stays in grant-store.ts. A fire commits the monitor
 * and the quota increment together: in-process, inside one lock; on Upstash,
 * inside one Lua script. A no-move never touches `used`.
 *
 * Production with no Upstash credentials and no GRANT_STORE=memory returns null.
 * Callers fail closed.
 */
import { createHash } from "node:crypto";
import type { PriceSample } from "@/lib/trigger";

export const GRANT_KEY_PREFIX = "harbinger:grant:";
const MONITOR_PREFIX = "harbinger:monitor:";
const INDEX_PREFIX = "harbinger:monitor-idx:";
const PENDING_KEY = "harbinger:monitor-pending";
const OUTBOX_KEY = "harbinger:monitor-outbox";

export type HookState = "armed" | "queued" | "inflight" | "delivered" | "skipped" | "dead";

export type HookDelivery = {
  url: string;
  state: HookState;
  attempts: number;
  lockedUntil: number;
  lastError?: string;
};

export type GrantSnap = { watchId: string; used: number; quota: number; expiresAt: number };

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

export type ConsumeOutcome =
  | { ok: true; demo?: boolean; grant?: GrantSnap }
  | { ok: false; reason: "exhausted" | "expired" | "unbound" | "unavailable" };

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
  /** Insert, or return the current pending monitor for this grant and watch. */
  create(monitor: Monitor): Promise<Monitor>;
  /**
   * Write `next` if `expectedVersion` still matches and the monitor is pending.
   * For `fire` on a tx grant, the memory store runs `consume` inside the lock
   * and patches `ping.grant.used` from the binding it returns. Upstash does the
   * increment in the same script and ignores `consume` so the unit cannot be
   * spent twice.
   */
  commit(opts: {
    expectedVersion: number;
    next: Monitor;
    op: CommitOp;
    now: number;
    consume?: () => Promise<ConsumeOutcome>;
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

function acceptCreate(prev: Monitor | null, incoming: Monitor): Monitor | null {
  if (!prev) return null;
  if (prev.status === "pending") return prev;
  if (prev.generation >= incoming.generation) return prev;
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

  async create(monitor: Monitor): Promise<Monitor> {
    const key = indexKey(monitor.grantKey, monitor.watchId);
    return this.lock(`idx:${key}`, async () => {
      const idx = this.index.get(key);
      const prev = idx ? (this.map.get(idx.id) ?? null) : null;
      const keep = acceptCreate(prev, monitor);
      if (keep) return structuredClone(keep);
      const stored = structuredClone(monitor);
      this.map.set(stored.id, stored);
      this.index.set(key, { id: stored.id, generation: stored.generation });
      if (stored.status === "pending") this.pending.add(stored.id);
      return structuredClone(stored);
    });
  }

  private track(m: Monitor) {
    if (m.status === "pending") this.pending.add(m.id);
    else this.pending.delete(m.id);
    if (m.hook?.state === "queued" || m.hook?.state === "inflight") this.outbox.add(m.id);
    else this.outbox.delete(m.id);
  }

  async commit(opts: {
    expectedVersion: number;
    next: Monitor;
    op: CommitOp;
    now: number;
    consume?: () => Promise<ConsumeOutcome>;
  }): Promise<FinishResult> {
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
          if (!opts.consume) return { ok: false, reason: "unavailable", monitor: structuredClone(current) };
          const spent = await opts.consume();
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
          next = patchFired(next, spent.grant, Boolean(spent.demo));
        }
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

const FIRE_LUA = `
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
  if now >= tonumber(b.expiresAt) then
    cur.status = 'closed'
    cur.closedReason = 'expired'
    cur.version = tonumber(cur.version) + 1
    redis.call('SET', KEYS[1], cjson.encode(cur))
    redis.call('SREM', KEYS[2], cur.id)
    return reply({ok=false, reason='expired', monitor=cur})
  end
  if tonumber(b.used) >= tonumber(b.quota) then
    cur.status = 'closed'
    cur.closedReason = 'exhausted'
    cur.version = tonumber(cur.version) + 1
    redis.call('SET', KEYS[1], cjson.encode(cur))
    redis.call('SREM', KEYS[2], cur.id)
    return reply({ok=false, reason='exhausted', monitor=cur})
  end
  b.used = tonumber(b.used) + 1
  redis.call('SET', KEYS[4], cjson.encode(b))
  nxt.consumed = true
  nxt.grant = { watchId = b.watchId, used = b.used, quota = tonumber(b.quota), expiresAt = tonumber(b.expiresAt) }
  if nxt.ping and nxt.ping.grant then nxt.ping.grant.used = b.used end
  if nxt.ping then nxt.deliveryBody = cjson.encode(nxt.ping) end
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

const CREATE_LUA = `
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
  end
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
local incoming = cjson.decode(ARGV[3])
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
    return this.parse(await this.cmd(["GET", MONITOR_PREFIX + id]));
  }

  async find(grantKey: string, watchId: string): Promise<Monitor | null> {
    const idxRaw = await this.cmd(["GET", INDEX_PREFIX + indexKey(grantKey, watchId)]);
    if (typeof idxRaw !== "string" || !idxRaw) return null;
    const idx = JSON.parse(idxRaw) as { id: string };
    return this.get(idx.id);
  }

  async create(monitor: Monitor): Promise<Monitor> {
    const raw = await this.cmd([
      "EVAL",
      CREATE_LUA,
      3,
      INDEX_PREFIX + indexKey(monitor.grantKey, monitor.watchId),
      MONITOR_PREFIX + monitor.id,
      PENDING_KEY,
      MONITOR_PREFIX,
      JSON.stringify({ id: monitor.id, generation: monitor.generation }),
      JSON.stringify(monitor),
    ]);
    return this.parse(raw) ?? monitor;
  }

  async commit(opts: {
    expectedVersion: number;
    next: Monitor;
    op: CommitOp;
    now: number;
    consume?: () => Promise<ConsumeOutcome>;
  }): Promise<FinishResult> {
    const keys = [MONITOR_PREFIX + opts.next.id, PENDING_KEY, OUTBOX_KEY];
    if (opts.op === "fire" && opts.next.grantKey !== "demo") keys.push(GRANT_KEY_PREFIX + opts.next.grantKey);
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
    const ids = await this.cmd(["SMEMBERS", PENDING_KEY]);
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
    const ids = await this.cmd(["SMEMBERS", OUTBOX_KEY]);
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
    const raw = await this.cmd(["EVAL", CLAIM_LUA, 1, MONITOR_PREFIX + id, now, lockMs]);
    return this.parse(raw);
  }

  async settleDelivery(id: string, result: { ok: boolean; error?: string }, maxAttempts: number): Promise<Monitor | null> {
    const raw = await this.cmd([
      "EVAL",
      SETTLE_LUA,
      2,
      MONITOR_PREFIX + id,
      OUTBOX_KEY,
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
  if (url && token) return new UpstashMonitorStore(url, token);
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
