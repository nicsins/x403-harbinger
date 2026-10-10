/**
 * Durable pending-monitor and hook outbox.
 *
 * A tx grant is bound (used stays 0) when a monitor is opened. `used` increments
 * inside the same critical section as the pending → fired transition, so two
 * polls or two pump runs consume one unit. no-move never touches `used`.
 * Delivery claims are separate: a retry POSTs again and does not redeem.
 *
 * Memory methods mirror the Lua in this file. Production uses one EVAL per
 * transition against the same Upstash database as the grant store. Production
 * without that database fails closed (null), same rule as `grantStoreFromEnv`.
 */
import {
  GRANT_KEY_PREFIX,
  sharedMemoryStore,
  upstashRest,
  type GrantBinding,
  type GrantStore,
} from "@/lib/grant-store";

export const HOOK_MAX_ATTEMPTS = 5;
export const HOOK_LOCK_MS = 20_000;
const SAMPLE_CAP = 128;
const OPEN_PREFIX = "harbinger:mon:open:";
const MON_PREFIX = "harbinger:mon:";
const PENDING_KEY = "harbinger:mon:pending";
const OUTBOX_KEY = "harbinger:mon:outbox";

export function hookBackoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 900_000);
}

export type MonitorKind = "stream" | "hook";
export type MonitorStatus = "pending" | "fired" | "no-move";

export type MonitorSample = { at: number; prices: Record<string, number> };

export type DeliveryState = {
  status: "pending" | "inflight" | "delivered" | "failed" | "skipped";
  attempts: number;
  lockUntil?: number;
  nextAttemptAt?: number;
  lastError?: string;
  deliveredAt?: number;
};

export type Monitor = {
  id: string;
  kind: MonitorKind;
  watchId: string;
  /** Lowercase tx hash, or "demo". */
  grantKey: string;
  startedAt: number;
  deadlineAt: number;
  baseline: Record<string, { price: number; asOf: number }>;
  samples: MonitorSample[];
  status: MonitorStatus;
  firedAt: number | null;
  consumed: boolean;
  result: Record<string, unknown> | null;
  callbackUrl?: string;
  hookSecret?: string;
  delivery?: DeliveryState;
  grantUsed?: number;
  grantQuota?: number;
};

export type MonitorOp =
  | { ok: true; monitor: Monitor; idempotent?: boolean; created?: boolean; claimed?: boolean; already?: boolean }
  | { ok: false; reason: string; monitor?: Monitor; binding?: GrantBinding };

export interface MonitorStore {
  readonly kind: "memory" | "upstash";
  get(id: string): Promise<Monitor | null>;
  findByGrant(grantKey: string, watchId: string): Promise<Monitor | null>;
  create(monitor: Monitor, renew: boolean): Promise<{ created: boolean; monitor: Monitor }>;
  appendSample(id: string, sample: MonitorSample): Promise<MonitorOp>;
  fire(id: string, now: number, firedAt: number, result: Record<string, unknown>, sample: MonitorSample | null): Promise<MonitorOp>;
  noMove(id: string, now: number, result: Record<string, unknown>): Promise<MonitorOp>;
  listPending(limit: number): Promise<string[]>;
  listOutbox(limit: number): Promise<string[]>;
  claimDelivery(id: string, now: number): Promise<MonitorOp>;
  ackDelivery(id: string, now: number, delivered: boolean, error?: string, terminal?: boolean): Promise<MonitorOp>;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function pushSample(m: Monitor, sample: MonitorSample) {
  const last = m.samples[m.samples.length - 1];
  if (!last || sample.at > last.at) m.samples.push(sample);
  while (m.samples.length > SAMPLE_CAP) m.samples.shift();
}

export function normalizeMonitor(raw: Monitor): Monitor {
  const delivery = raw.delivery
    ? {
        status: raw.delivery.status,
        attempts: Number(raw.delivery.attempts ?? 0),
        ...(raw.delivery.lockUntil != null ? { lockUntil: Number(raw.delivery.lockUntil) } : {}),
        ...(raw.delivery.nextAttemptAt != null ? { nextAttemptAt: Number(raw.delivery.nextAttemptAt) } : {}),
        ...(raw.delivery.lastError ? { lastError: String(raw.delivery.lastError) } : {}),
        ...(raw.delivery.deliveredAt != null ? { deliveredAt: Number(raw.delivery.deliveredAt) } : {}),
      }
    : undefined;
  const baseline: Monitor["baseline"] = {};
  for (const [k, v] of Object.entries(raw.baseline ?? {})) {
    baseline[k] = { price: Number(v.price), asOf: Number(v.asOf) };
  }
  return {
    id: String(raw.id),
    kind: raw.kind,
    watchId: String(raw.watchId),
    grantKey: String(raw.grantKey),
    startedAt: Number(raw.startedAt),
    deadlineAt: Number(raw.deadlineAt),
    baseline,
    samples: Array.isArray(raw.samples)
      ? raw.samples.map((s) => ({
          at: Number(s.at),
          prices: Object.fromEntries(Object.entries(s.prices ?? {}).map(([k, n]) => [k, Number(n)])),
        }))
      : [],
    status: raw.status,
    firedAt: raw.firedAt == null ? null : Number(raw.firedAt),
    consumed: Boolean(raw.consumed),
    result: raw.result ?? null,
    ...(raw.callbackUrl ? { callbackUrl: String(raw.callbackUrl) } : {}),
    ...(raw.hookSecret ? { hookSecret: String(raw.hookSecret) } : {}),
    ...(delivery ? { delivery } : {}),
    ...(raw.grantUsed != null ? { grantUsed: Number(raw.grantUsed) } : {}),
    ...(raw.grantQuota != null ? { grantQuota: Number(raw.grantQuota) } : {}),
  };
}

export class MemoryMonitorStore implements MonitorStore {
  readonly kind = "memory" as const;
  private readonly monitors = new Map<string, Monitor>();
  private readonly open = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly outbox = new Set<string>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly grants: GrantStore) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private index(grantKey: string, watchId: string) {
    return `${grantKey}:${watchId}`;
  }

  async get(id: string): Promise<Monitor | null> {
    const m = this.monitors.get(id);
    return m ? clone(m) : null;
  }

  async findByGrant(grantKey: string, watchId: string): Promise<Monitor | null> {
    const id = this.open.get(this.index(grantKey, watchId));
    return id ? this.get(id) : null;
  }

  async create(monitor: Monitor, renew: boolean): Promise<{ created: boolean; monitor: Monitor }> {
    return this.exclusive(async () => {
      const key = this.index(monitor.grantKey, monitor.watchId);
      const existingId = this.open.get(key);
      const existing = existingId ? this.monitors.get(existingId) : undefined;
      if (existing && (existing.status === "pending" || !renew)) {
        return { created: false, monitor: clone(existing) };
      }
      if (existing) this.pending.delete(existing.id);
      const stored = clone(monitor);
      this.monitors.set(stored.id, stored);
      this.open.set(key, stored.id);
      this.pending.add(stored.id);
      return { created: true, monitor: clone(stored) };
    });
  }

  async appendSample(id: string, sample: MonitorSample): Promise<MonitorOp> {
    return this.exclusive(async () => {
      const m = this.monitors.get(id);
      if (!m) return { ok: false, reason: "missing" };
      if (m.status === "pending") pushSample(m, sample);
      return { ok: true, monitor: clone(m) };
    });
  }

  async fire(id: string, now: number, firedAt: number, result: Record<string, unknown>, sample: MonitorSample | null): Promise<MonitorOp> {
    return this.exclusive(async () => {
      const m = this.monitors.get(id);
      if (!m) return { ok: false, reason: "missing" };
      if (m.status === "fired" || m.status === "no-move") return { ok: true, idempotent: true, monitor: clone(m) };
      if (m.grantKey !== "demo") {
        const redeemed = await this.grants.redeem(m.grantKey, m.watchId, now, true);
        if (!redeemed.ok) {
          const reason =
            redeemed.reason === "exhausted" || redeemed.reason === "expired" || redeemed.reason === "watch-mismatch"
              ? redeemed.reason
              : "grant-missing";
          return { ok: false, reason, ...(redeemed.binding ? { binding: redeemed.binding } : {}), monitor: clone(m) };
        }
        m.grantUsed = redeemed.binding.used;
        m.grantQuota = redeemed.binding.quota;
      }
      if (sample) pushSample(m, sample);
      m.status = "fired";
      m.consumed = true;
      m.firedAt = firedAt;
      m.result = clone(result);
      if (m.kind === "hook") {
        m.delivery = { status: "pending", attempts: 0, lockUntil: 0 };
        this.outbox.add(m.id);
      }
      this.pending.delete(m.id);
      return { ok: true, idempotent: false, monitor: clone(m) };
    });
  }

  async noMove(id: string, now: number, result: Record<string, unknown>): Promise<MonitorOp> {
    return this.exclusive(async () => {
      const m = this.monitors.get(id);
      if (!m) return { ok: false, reason: "missing" };
      if (m.status === "fired" || m.status === "no-move") return { ok: true, idempotent: true, monitor: clone(m) };
      if (now < m.deadlineAt) return { ok: false, reason: "early", monitor: clone(m) };
      m.status = "no-move";
      m.firedAt = null;
      m.consumed = false;
      m.result = clone(result);
      m.delivery = { status: "skipped", attempts: 0, lockUntil: 0 };
      this.pending.delete(m.id);
      this.outbox.delete(m.id);
      return { ok: true, monitor: clone(m) };
    });
  }

  async listPending(limit: number): Promise<string[]> {
    return [...this.pending].slice(0, limit);
  }

  async listOutbox(limit: number): Promise<string[]> {
    return [...this.outbox].slice(0, limit);
  }

  async claimDelivery(id: string, now: number): Promise<MonitorOp> {
    return this.exclusive(async () => {
      const m = this.monitors.get(id);
      if (!m) return { ok: false, reason: "missing" };
      if (m.status !== "fired") return { ok: false, reason: "not-fired", monitor: clone(m) };
      if (!m.delivery || m.delivery.status === "skipped") return { ok: false, reason: "skipped", monitor: clone(m) };
      if (m.delivery.status === "delivered") return { ok: true, already: true, claimed: false, monitor: clone(m) };
      if (m.delivery.status === "failed") return { ok: false, reason: "failed", monitor: clone(m) };
      if ((m.delivery.lockUntil ?? 0) > now) return { ok: false, reason: "busy", monitor: clone(m) };
      if ((m.delivery.nextAttemptAt ?? 0) > now) return { ok: false, reason: "wait", monitor: clone(m) };
      const attempts = (m.delivery.attempts ?? 0) + 1;
      if (attempts > HOOK_MAX_ATTEMPTS) {
        m.delivery.status = "failed";
        m.delivery.lockUntil = 0;
        this.outbox.delete(id);
        return { ok: false, reason: "failed", monitor: clone(m) };
      }
      m.delivery.attempts = attempts;
      m.delivery.lockUntil = now + HOOK_LOCK_MS;
      m.delivery.status = "inflight";
      return { ok: true, claimed: true, monitor: clone(m) };
    });
  }

  async ackDelivery(id: string, now: number, delivered: boolean, error?: string, terminal = false): Promise<MonitorOp> {
    return this.exclusive(async () => {
      const m = this.monitors.get(id);
      if (!m?.delivery) return { ok: false, reason: "missing" };
      if (m.delivery.status === "delivered") return { ok: true, monitor: clone(m) };
      if (delivered) {
        m.delivery.status = "delivered";
        m.delivery.deliveredAt = now;
        m.delivery.lockUntil = 0;
        delete m.delivery.lastError;
        this.outbox.delete(id);
        return { ok: true, monitor: clone(m) };
      }
      m.delivery.lastError = error ?? "delivery-failed";
      m.delivery.lockUntil = 0;
      if (terminal || m.delivery.attempts >= HOOK_MAX_ATTEMPTS) {
        m.delivery.status = "failed";
        this.outbox.delete(id);
        return { ok: true, monitor: clone(m) };
      }
      m.delivery.status = "pending";
      m.delivery.nextAttemptAt = now + hookBackoffMs(m.delivery.attempts);
      return { ok: true, monitor: clone(m) };
    });
  }
}

function parseEval(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") throw new Error("grant store: bad EVAL result");
  return JSON.parse(raw) as Record<string, unknown>;
}

function asBinding(v: unknown): GrantBinding | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as GrantBinding;
  if (!b.watchId) return undefined;
  return {
    watchId: String(b.watchId),
    quota: Number(b.quota),
    used: Number(b.used),
    boundAt: Number(b.boundAt),
    expiresAt: Number(b.expiresAt),
    paidAtomic: String(b.paidAtomic),
  };
}

function opFromEval(parsed: Record<string, unknown>): MonitorOp {
  const monitor = parsed.monitor ? normalizeMonitor(parsed.monitor as Monitor) : undefined;
  if (parsed.ok === true && monitor) {
    return {
      ok: true,
      monitor,
      ...(parsed.idempotent != null ? { idempotent: Boolean(parsed.idempotent) } : {}),
      ...(parsed.claimed != null ? { claimed: Boolean(parsed.claimed) } : {}),
      ...(parsed.already != null ? { already: Boolean(parsed.already) } : {}),
    };
  }
  const binding = asBinding(parsed.binding);
  return {
    ok: false,
    reason: String(parsed.reason ?? "missing"),
    ...(monitor ? { monitor } : {}),
    ...(binding ? { binding } : {}),
  };
}

/** Create: KEYS open, new monitor, pending set, previous monitor. ARGV id, json, renew. */
export const MONITOR_CREATE_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur and cur ~= '' and ARGV[3] ~= '1' then
  return cjson.encode({ok=true, created=false, id=cur})
end
if cur and cur ~= '' and ARGV[3] == '1' then
  local oldRaw = redis.call('GET', KEYS[4])
  if oldRaw then
    local old = cjson.decode(oldRaw)
    if old.status == 'pending' then
      return cjson.encode({ok=true, created=false, id=cur})
    end
    redis.call('SREM', KEYS[3], cur)
  end
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SADD', KEYS[3], ARGV[1])
return cjson.encode({ok=true, created=true, id=ARGV[1]})
`;

/** Append a post-start sample only while pending. */
export const MONITOR_APPEND_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ok=false, reason='missing'}) end
local m = cjson.decode(raw)
if m.status ~= 'pending' then return cjson.encode({ok=true, monitor=m}) end
local s = cjson.decode(ARGV[1])
if m.samples == nil then m.samples = {} end
local n = #m.samples
if n == 0 or tonumber(s.at) > tonumber(m.samples[n].at) then
  table.insert(m.samples, s)
  while #m.samples > 128 do table.remove(m.samples, 1) end
  redis.call('SET', KEYS[1], cjson.encode(m))
end
return cjson.encode({ok=true, monitor=m})
`;

/**
 * Fire and consume one grant unit. Already-terminal monitors return the stored
 * result and do not increment `used` again.
 * KEYS: monitor, grant, pending, outbox.
 * ARGV: now, firedAt, result json, sample json or '', watchId, isDemo.
 */
export const MONITOR_FIRE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ok=false, reason='missing'}) end
local m = cjson.decode(raw)
if m.status == 'fired' or m.status == 'no-move' then
  return cjson.encode({ok=true, idempotent=true, monitor=m})
end
if ARGV[6] ~= '1' then
  local graw = redis.call('GET', KEYS[2])
  if not graw or graw == '' then
    return cjson.encode({ok=false, reason='grant-missing'})
  end
  local b = cjson.decode(graw)
  if b.watchId ~= ARGV[5] then
    return cjson.encode({ok=false, reason='watch-mismatch', binding=b})
  end
  local now = tonumber(ARGV[1])
  if now >= tonumber(b.expiresAt) then
    return cjson.encode({ok=false, reason='expired', binding=b})
  end
  if tonumber(b.used) >= tonumber(b.quota) then
    return cjson.encode({ok=false, reason='exhausted', binding=b})
  end
  b.used = tonumber(b.used) + 1
  redis.call('SET', KEYS[2], cjson.encode(b))
  m.grantUsed = b.used
  m.grantQuota = b.quota
end
if ARGV[4] ~= '' then
  local s = cjson.decode(ARGV[4])
  if m.samples == nil then m.samples = {} end
  local n = #m.samples
  if n == 0 or tonumber(s.at) > tonumber(m.samples[n].at) then
    table.insert(m.samples, s)
    while #m.samples > 128 do table.remove(m.samples, 1) end
  end
end
m.status = 'fired'
m.consumed = true
m.firedAt = tonumber(ARGV[2])
m.result = cjson.decode(ARGV[3])
if m.kind == 'hook' then
  m.delivery = {status='pending', attempts=0, lockUntil=0}
  redis.call('SADD', KEYS[4], m.id)
end
redis.call('SET', KEYS[1], cjson.encode(m))
redis.call('SREM', KEYS[3], m.id)
return cjson.encode({ok=true, idempotent=false, monitor=m})
`;

/** no-move does not read or write the grant key. */
export const MONITOR_NOMOVE_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ok=false, reason='missing'}) end
local m = cjson.decode(raw)
if m.status == 'fired' or m.status == 'no-move' then
  return cjson.encode({ok=true, idempotent=true, monitor=m})
end
local now = tonumber(ARGV[1])
if now < tonumber(m.deadlineAt) then
  return cjson.encode({ok=false, reason='early', monitor=m})
end
m.status = 'no-move'
m.firedAt = cjson.null
m.consumed = false
m.result = cjson.decode(ARGV[2])
m.delivery = {status='skipped', attempts=0, lockUntil=0}
redis.call('SET', KEYS[1], cjson.encode(m))
redis.call('SREM', KEYS[2], m.id)
redis.call('SREM', KEYS[3], m.id)
return cjson.encode({ok=true, monitor=m})
`;

export const MONITOR_CLAIM_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ok=false, reason='missing'}) end
local m = cjson.decode(raw)
if m.status ~= 'fired' then return cjson.encode({ok=false, reason='not-fired', monitor=m}) end
if m.delivery == nil or m.delivery.status == 'skipped' then
  return cjson.encode({ok=false, reason='skipped', monitor=m})
end
if m.delivery.status == 'delivered' then
  return cjson.encode({ok=true, already=true, claimed=false, monitor=m})
end
if m.delivery.status == 'failed' then
  return cjson.encode({ok=false, reason='failed', monitor=m})
end
local now = tonumber(ARGV[1])
local lockMs = tonumber(ARGV[2])
local maxAttempts = tonumber(ARGV[3])
if m.delivery.lockUntil and tonumber(m.delivery.lockUntil) > now then
  return cjson.encode({ok=false, reason='busy', monitor=m})
end
if m.delivery.nextAttemptAt and tonumber(m.delivery.nextAttemptAt) > now then
  return cjson.encode({ok=false, reason='wait', monitor=m})
end
local attempts = tonumber(m.delivery.attempts or 0) + 1
if attempts > maxAttempts then
  m.delivery.status = 'failed'
  m.delivery.lockUntil = 0
  redis.call('SET', KEYS[1], cjson.encode(m))
  redis.call('SREM', KEYS[2], m.id)
  return cjson.encode({ok=false, reason='failed', monitor=m})
end
m.delivery.attempts = attempts
m.delivery.lockUntil = now + lockMs
m.delivery.status = 'inflight'
redis.call('SET', KEYS[1], cjson.encode(m))
return cjson.encode({ok=true, claimed=true, monitor=m})
`;

export const MONITOR_ACK_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({ok=false, reason='missing'}) end
local m = cjson.decode(raw)
if m.delivery == nil then return cjson.encode({ok=false, reason='missing', monitor=m}) end
if m.delivery.status == 'delivered' then
  return cjson.encode({ok=true, monitor=m})
end
local now = tonumber(ARGV[1])
local delivered = ARGV[2] == '1'
local terminal = ARGV[3] == '1'
local maxAttempts = tonumber(ARGV[4])
local err = ARGV[5]
if delivered then
  m.delivery.status = 'delivered'
  m.delivery.deliveredAt = now
  m.delivery.lockUntil = 0
  redis.call('SET', KEYS[1], cjson.encode(m))
  redis.call('SREM', KEYS[2], m.id)
  return cjson.encode({ok=true, monitor=m})
end
m.delivery.lastError = err
m.delivery.lockUntil = 0
local attempts = tonumber(m.delivery.attempts or 0)
if terminal or attempts >= maxAttempts then
  m.delivery.status = 'failed'
  redis.call('SET', KEYS[1], cjson.encode(m))
  redis.call('SREM', KEYS[2], m.id)
  return cjson.encode({ok=true, monitor=m})
end
local backoff = 30000 * (2 ^ math.max(0, attempts - 1))
if backoff > 900000 then backoff = 900000 end
m.delivery.status = 'pending'
m.delivery.nextAttemptAt = now + backoff
redis.call('SET', KEYS[1], cjson.encode(m))
return cjson.encode({ok=true, monitor=m})
`;

export class UpstashMonitorStore implements MonitorStore {
  readonly kind = "upstash" as const;
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private cmd(args: (string | number)[]) {
    return upstashRest(this.url, this.token, args);
  }

  private monKey(id: string) {
    return MON_PREFIX + id;
  }

  private openKey(grantKey: string, watchId: string) {
    return `${OPEN_PREFIX}${grantKey}:${watchId}`;
  }

  private grantKey(tx: string) {
    return GRANT_KEY_PREFIX + tx.toLowerCase();
  }

  async get(id: string): Promise<Monitor | null> {
    const raw = await this.cmd(["GET", this.monKey(id)]);
    if (typeof raw !== "string") return null;
    return normalizeMonitor(JSON.parse(raw) as Monitor);
  }

  async findByGrant(grantKey: string, watchId: string): Promise<Monitor | null> {
    const id = await this.cmd(["GET", this.openKey(grantKey, watchId)]);
    if (typeof id !== "string" || !id) return null;
    return this.get(id);
  }

  async create(monitor: Monitor, renew: boolean): Promise<{ created: boolean; monitor: Monitor }> {
    const existing = await this.cmd(["GET", this.openKey(monitor.grantKey, monitor.watchId)]);
    const oldKey = typeof existing === "string" && existing ? this.monKey(existing) : this.monKey(monitor.id);
    const raw = await this.cmd([
      "EVAL",
      MONITOR_CREATE_LUA,
      4,
      this.openKey(monitor.grantKey, monitor.watchId),
      this.monKey(monitor.id),
      PENDING_KEY,
      oldKey,
      monitor.id,
      JSON.stringify(monitor),
      renew ? "1" : "0",
    ]);
    const parsed = parseEval(raw);
    const id = String(parsed.id ?? monitor.id);
    const stored = await this.get(id);
    if (!stored) throw new Error("grant store: monitor missing after create");
    return { created: Boolean(parsed.created), monitor: stored };
  }

  async appendSample(id: string, sample: MonitorSample): Promise<MonitorOp> {
    const raw = await this.cmd(["EVAL", MONITOR_APPEND_LUA, 1, this.monKey(id), JSON.stringify(sample)]);
    return opFromEval(parseEval(raw));
  }

  async fire(id: string, now: number, firedAt: number, result: Record<string, unknown>, sample: MonitorSample | null): Promise<MonitorOp> {
    const current = await this.get(id);
    if (!current) return { ok: false, reason: "missing" };
    const demo = current.grantKey === "demo";
    const raw = await this.cmd([
      "EVAL",
      MONITOR_FIRE_LUA,
      4,
      this.monKey(id),
      demo ? `${GRANT_KEY_PREFIX}demo-skip` : this.grantKey(current.grantKey),
      PENDING_KEY,
      OUTBOX_KEY,
      now,
      firedAt,
      JSON.stringify(result),
      sample ? JSON.stringify(sample) : "",
      current.watchId,
      demo ? "1" : "0",
    ]);
    return opFromEval(parseEval(raw));
  }

  async noMove(id: string, now: number, result: Record<string, unknown>): Promise<MonitorOp> {
    const raw = await this.cmd([
      "EVAL",
      MONITOR_NOMOVE_LUA,
      3,
      this.monKey(id),
      PENDING_KEY,
      OUTBOX_KEY,
      now,
      JSON.stringify(result),
    ]);
    return opFromEval(parseEval(raw));
  }

  async listPending(limit: number): Promise<string[]> {
    const raw = await this.cmd(["SMEMBERS", PENDING_KEY]);
    const ids = Array.isArray(raw) ? raw.map(String) : [];
    return ids.slice(0, limit);
  }

  async listOutbox(limit: number): Promise<string[]> {
    const raw = await this.cmd(["SMEMBERS", OUTBOX_KEY]);
    const ids = Array.isArray(raw) ? raw.map(String) : [];
    return ids.slice(0, limit);
  }

  async claimDelivery(id: string, now: number): Promise<MonitorOp> {
    const raw = await this.cmd([
      "EVAL",
      MONITOR_CLAIM_LUA,
      2,
      this.monKey(id),
      OUTBOX_KEY,
      now,
      HOOK_LOCK_MS,
      HOOK_MAX_ATTEMPTS,
    ]);
    return opFromEval(parseEval(raw));
  }

  async ackDelivery(id: string, now: number, delivered: boolean, error?: string, terminal = false): Promise<MonitorOp> {
    const raw = await this.cmd([
      "EVAL",
      MONITOR_ACK_LUA,
      2,
      this.monKey(id),
      OUTBOX_KEY,
      now,
      delivered ? "1" : "0",
      terminal ? "1" : "0",
      HOOK_MAX_ATTEMPTS,
      error ?? "",
    ]);
    return opFromEval(parseEval(raw));
  }
}

type Env = Record<string, string | undefined>;

export function monitorStoreFromEnv(env: Env = process.env): MonitorStore | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashMonitorStore(url, token);
  if (env.VERCEL_ENV === "production" && env.GRANT_STORE !== "memory") return null;
  return sharedMonitorStore();
}

const g = globalThis as unknown as { __harbingerMonitorStore?: MemoryMonitorStore };

export function sharedMonitorStore(): MemoryMonitorStore {
  if (!g.__harbingerMonitorStore) g.__harbingerMonitorStore = new MemoryMonitorStore(sharedMemoryStore());
  return g.__harbingerMonitorStore;
}

export function resetSharedMonitorStore(): void {
  g.__harbingerMonitorStore = undefined;
}
