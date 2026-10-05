/**
 * Grant binding store: txHash -> { watchId, quota, used, reserved, expiresAt }.
 *
 * A record is written on the first successful redemption of a tx grant and is
 * never deleted (not even after expiry), so an expired or exhausted tx can never
 * be re-bound to a fresh watch. One small key per paid tx.
 *
 * `reserved` counts units held by pending monitors. Legacy records with no
 * field are treated as 0. `reservation` maps a monitor id to held | converted |
 * released so a retried pump cannot release twice or convert twice, and so
 * `reserved` never drops below 0.
 *
 * Direct spend (patrol, agentmail) needs `used + reserved < quota`, then
 * `used += 1`. When that fails and `reserved > 0`, the reason is `reserved`
 * (HTTP 409). When `reserved == 0`, the reason is `exhausted` (HTTP 403).
 * Arming reserves (`reserved += 1`) under the same availability check.
 * A fire converts a held unit (`reserved -= 1; used += 1`) without re-checking
 * availability. A no-move or deadline release only decrements `reserved`.
 *
 * The mutations live in this file as JS (`apply*`) and as Lua (`GRANT_LUA_LIB`).
 * Upstash runs them with EVAL. CREATE_LUA / FIRE_LUA in lib/monitor-store.ts
 * inline the same Lua so the monitor row and the counter commit in one script.
 *
 * Backends:
 * - Upstash Redis REST. Selected when KV_REST_API_URL + KV_REST_API_TOKEN or
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Plain fetch, no SDK.
 * - In-memory (dev/preview fallback). Process-local. Production refuses it unless
 *   GRANT_STORE=memory is set (see grantStoreFromEnv).
 *
 * Keys are namespaced per environment (lib/store-keys.ts): prod un-prefixed,
 * preview/dev under `preview:` / `dev:`. Lua receives keys only through KEYS.
 */
import { storeKeys } from "@/lib/store-keys";

export type ReservationState = "held" | "converted" | "released";
export type ReservationMap = Record<string, ReservationState>;

export type GrantBinding = {
  watchId: string;
  /** Total uses this tx buys on watchId. */
  quota: number;
  /** Uses consumed so far. */
  used: number;
  /**
   * Units held by pending monitors. Missing on legacy records; readers treat
   * that as 0.
   */
  reserved?: number;
  /** Per-monitor idempotency. Missing on legacy records. */
  reservation?: ReservationMap;
  /** Epoch ms of first redemption. */
  boundAt: number;
  /** Epoch ms after which the grant is dead. */
  expiresAt: number;
  /** USDC atomic units (6dp) paid to payTo in the tx, as decimal string. */
  paidAtomic: string;
};

export type RedeemReason = "watch-mismatch" | "expired" | "exhausted" | "reserved" | "unbound";

export type RedeemResult =
  | { ok: true; binding: GrantBinding }
  | { ok: false; reason: RedeemReason; binding?: GrantBinding };

export type GrantOpReason = RedeemReason | "unavailable";

export type ReserveResult =
  | { ok: true; binding: GrantBinding }
  | { ok: false; reason: GrantOpReason; binding?: GrantBinding };

export type ConvertResult =
  | { ok: true; binding: GrantBinding; idempotent?: boolean }
  | { ok: false; reason: "unbound" | "expired" | "exhausted" | "unavailable"; binding?: GrantBinding };

export type ReleaseResult = { ok: true; binding: GrantBinding | null; released: boolean };

export interface GrantStore {
  readonly kind: "memory" | "upstash";
  get(txHash: string): Promise<GrantBinding | null>;
  /**
   * Atomically: if no record exists and `proposal` is given, write it; then check
   * the record against watchId / now / quota. If consume, this is a direct spend:
   * allowed only when `used + reserved < quota`, then `used += 1`.
   */
  redeem(
    txHash: string,
    watchId: string,
    now: number,
    consume: boolean,
    proposal?: GrantBinding,
  ): Promise<RedeemResult>;
  /** Hold one unit for `monitorId`. Idempotent when that id is already held. */
  reserve(txHash: string, monitorId: string, watchId: string, now: number): Promise<ReserveResult>;
  /** Turn a held unit into a spend. Idempotent when that id is already converted. */
  convert(txHash: string, monitorId: string, now: number): Promise<ConvertResult>;
  /** Drop a held unit without spending. Idempotent when the id is not held. */
  release(txHash: string, monitorId: string): Promise<ReleaseResult>;
}

const RESERVATION_STATES = new Set<ReservationState>(["held", "converted", "released"]);

/** Legacy rows omit `reserved`. Every reader goes through this. */
export function normalizeBinding(b: GrantBinding): GrantBinding {
  const reserved = Number(b.reserved ?? 0);
  const reservation: ReservationMap = {};
  if (b.reservation && typeof b.reservation === "object" && !Array.isArray(b.reservation)) {
    for (const [id, state] of Object.entries(b.reservation)) {
      if (RESERVATION_STATES.has(state)) reservation[id] = state;
    }
  }
  const next: GrantBinding = {
    watchId: String(b.watchId),
    quota: Number(b.quota),
    used: Number(b.used ?? 0),
    reserved: Number.isFinite(reserved) ? reserved : 0,
    boundAt: Number(b.boundAt),
    expiresAt: Number(b.expiresAt),
    paidAtomic: String(b.paidAtomic ?? ""),
  };
  if (Object.keys(reservation).length) next.reservation = reservation;
  return next;
}

function copyReservation(b: GrantBinding, monitorId: string, state: ReservationState): ReservationMap {
  return { ...(b.reservation ?? {}), [monitorId]: state };
}

/** Pure check shared by the memory store and tests (mirrors REDEEM_LUA). */
export function applyRedeem(
  existing: GrantBinding | null,
  watchId: string,
  now: number,
  consume: boolean,
  proposal?: GrantBinding,
): { result: RedeemResult; next: GrantBinding | null } {
  const b = existing ? normalizeBinding(existing) : proposal ? normalizeBinding(proposal) : null;
  if (!b) return { result: { ok: false, reason: "unbound" }, next: null };
  if (b.watchId !== watchId) return { result: { ok: false, reason: "watch-mismatch", binding: b }, next: b };
  if (now >= b.expiresAt) return { result: { ok: false, reason: "expired", binding: b }, next: b };
  if (consume && b.used + (b.reserved ?? 0) >= b.quota) {
    const reason: RedeemReason = (b.reserved ?? 0) > 0 ? "reserved" : "exhausted";
    return { result: { ok: false, reason, binding: b }, next: b };
  }
  const next = consume ? normalizeBinding({ ...b, used: b.used + 1 }) : b;
  return { result: { ok: true, binding: next }, next };
}

/** Mirrors h_reserve in GRANT_LUA_LIB. Does not re-hold a settled monitor id. */
export function applyReserve(
  existing: GrantBinding | null,
  monitorId: string,
  watchId: string,
  now: number,
): { result: ReserveResult; next: GrantBinding | null } {
  if (!existing) return { result: { ok: false, reason: "unbound" }, next: null };
  const b = normalizeBinding(existing);
  if (b.watchId !== watchId) return { result: { ok: false, reason: "watch-mismatch", binding: b }, next: b };
  if (now >= b.expiresAt) return { result: { ok: false, reason: "expired", binding: b }, next: b };
  const state = b.reservation?.[monitorId];
  if (state === "held") return { result: { ok: true, binding: b }, next: b };
  if (state === "converted" || state === "released") {
    return { result: { ok: false, reason: "exhausted", binding: b }, next: b };
  }
  if (b.used + (b.reserved ?? 0) >= b.quota) {
    const reason: RedeemReason = (b.reserved ?? 0) > 0 ? "reserved" : "exhausted";
    return { result: { ok: false, reason, binding: b }, next: b };
  }
  const next = normalizeBinding({
    ...b,
    reserved: (b.reserved ?? 0) + 1,
    reservation: copyReservation(b, monitorId, "held"),
  });
  return { result: { ok: true, binding: next }, next };
}

/** Mirrors h_convert. A converted id does not spend again. Expiry releases instead. */
export function applyConvert(
  existing: GrantBinding | null,
  monitorId: string,
  now: number,
): { result: ConvertResult; next: GrantBinding | null } {
  if (!existing) return { result: { ok: false, reason: "unbound" }, next: null };
  const b = normalizeBinding(existing);
  if (now >= b.expiresAt) {
    const released = applyRelease(b, monitorId);
    return { result: { ok: false, reason: "expired", ...(released.next ? { binding: released.next } : {}) }, next: released.next };
  }
  const state = b.reservation?.[monitorId];
  if (state === "converted") return { result: { ok: true, binding: b, idempotent: true }, next: b };
  if (state !== "held") return { result: { ok: false, reason: "exhausted", binding: b }, next: b };
  const next = normalizeBinding({
    ...b,
    reserved: Math.max(0, (b.reserved ?? 0) - 1),
    used: b.used + 1,
    reservation: copyReservation(b, monitorId, "converted"),
  });
  return { result: { ok: true, binding: next }, next };
}

/** Mirrors h_release. A missing, converted, or already released id is a no-op. */
export function applyRelease(
  existing: GrantBinding | null,
  monitorId: string,
): { result: ReleaseResult; next: GrantBinding | null } {
  if (!existing) return { result: { ok: true, binding: null, released: false }, next: null };
  const b = normalizeBinding(existing);
  if (b.reservation?.[monitorId] !== "held") {
    return { result: { ok: true, binding: b, released: false }, next: b };
  }
  const next = normalizeBinding({
    ...b,
    reserved: Math.max(0, (b.reserved ?? 0) - 1),
    reservation: copyReservation(b, monitorId, "released"),
  });
  return { result: { ok: true, binding: next, released: true }, next };
}

export class MemoryGrantStore implements GrantStore {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, GrantBinding>();

  async get(txHash: string): Promise<GrantBinding | null> {
    return this.getNow(txHash);
  }

  /** Synchronous read. Safe inside another store's critical section. */
  getNow(txHash: string): GrantBinding | null {
    const b = this.map.get(txHash.toLowerCase());
    return b ? normalizeBinding(b) : null;
  }

  async redeem(txHash: string, watchId: string, now: number, consume: boolean, proposal?: GrantBinding) {
    return this.redeemNow(txHash, watchId, now, consume, proposal);
  }

  redeemNow(txHash: string, watchId: string, now: number, consume: boolean, proposal?: GrantBinding): RedeemResult {
    return this.mutate(txHash, (existing) => applyRedeem(existing, watchId, now, consume, proposal));
  }

  async reserve(txHash: string, monitorId: string, watchId: string, now: number) {
    return this.reserveNow(txHash, monitorId, watchId, now);
  }

  reserveNow(txHash: string, monitorId: string, watchId: string, now: number): ReserveResult {
    return this.mutate(txHash, (existing) => applyReserve(existing, monitorId, watchId, now));
  }

  async convert(txHash: string, monitorId: string, now: number) {
    return this.convertNow(txHash, monitorId, now);
  }

  convertNow(txHash: string, monitorId: string, now: number): ConvertResult {
    return this.mutate(txHash, (existing) => applyConvert(existing, monitorId, now));
  }

  async release(txHash: string, monitorId: string) {
    return this.releaseNow(txHash, monitorId);
  }

  releaseNow(txHash: string, monitorId: string): ReleaseResult {
    return this.mutate(txHash, (existing) => applyRelease(existing, monitorId));
  }

  private mutate<T>(
    txHash: string,
    fn: (existing: GrantBinding | null) => { result: T; next: GrantBinding | null },
  ): T {
    const key = txHash.toLowerCase();
    const { result, next } = fn(this.map.get(key) ?? null);
    if (next) this.map.set(key, next);
    return result;
  }
}

/**
 * Lua twins of applyReserve / applyConvert / applyRelease and of the consume
 * branch of applyRedeem. Inlined into every grant script and into the monitor
 * create/commit scripts. No key names here: callers pass keys through KEYS.
 */
export const GRANT_LUA_LIB = `
local function h_norm(b)
  b.used = tonumber(b.used) or 0
  b.quota = tonumber(b.quota) or 0
  b.reserved = tonumber(b.reserved) or 0
  b.expiresAt = tonumber(b.expiresAt) or 0
  if type(b.reservation) ~= 'table' then b.reservation = {} end
  return b
end
local function h_reserve(b, id, watchId, now)
  h_norm(b)
  if b.watchId ~= watchId then return 'watch-mismatch' end
  if now >= b.expiresAt then return 'expired' end
  local state = b.reservation[id]
  if state == 'held' then return nil end
  if state == 'converted' or state == 'released' then return 'exhausted' end
  if (b.used + b.reserved) >= b.quota then
    if b.reserved > 0 then return 'reserved' else return 'exhausted' end
  end
  b.reservation[id] = 'held'
  b.reserved = b.reserved + 1
  return nil
end
local function h_release(b, id)
  h_norm(b)
  if b.reservation[id] ~= 'held' then return false end
  b.reservation[id] = 'released'
  if b.reserved > 0 then b.reserved = b.reserved - 1 else b.reserved = 0 end
  return true
end
local function h_convert(b, id, now)
  h_norm(b)
  if now >= b.expiresAt then
    h_release(b, id)
    return 'expired'
  end
  local state = b.reservation[id]
  if state == 'converted' then return nil end
  if state ~= 'held' then return 'exhausted' end
  b.reservation[id] = 'converted'
  if b.reserved > 0 then b.reserved = b.reserved - 1 else b.reserved = 0 end
  b.used = b.used + 1
  return nil
end
`;

function grantScript(op: string, body: string): string {
  return `-- harbinger-op:${op}\n${GRANT_LUA_LIB}\n${body}`;
}

export const REDEEM_LUA = grantScript(
  "redeem",
  `
local v = redis.call('GET', KEYS[1])
local b
if v then
  b = cjson.decode(v)
elseif ARGV[4] ~= '' then
  b = cjson.decode(ARGV[4])
else
  return cjson.encode({ok=false, reason='unbound'})
end
h_norm(b)
local now = tonumber(ARGV[2])
if b.watchId ~= ARGV[1] then
  if not v then redis.call('SET', KEYS[1], cjson.encode(b)) end
  return cjson.encode({ok=false, reason='watch-mismatch', binding=b})
end
if now >= tonumber(b.expiresAt) then
  if not v then redis.call('SET', KEYS[1], cjson.encode(b)) end
  return cjson.encode({ok=false, reason='expired', binding=b})
end
if ARGV[3] == '1' then
  if (b.used + b.reserved) >= b.quota then
    local reason = 'exhausted'
    if b.reserved > 0 then reason = 'reserved' end
    if not v then redis.call('SET', KEYS[1], cjson.encode(b)) end
    return cjson.encode({ok=false, reason=reason, binding=b})
  end
  b.used = b.used + 1
end
redis.call('SET', KEYS[1], cjson.encode(b))
return cjson.encode({ok=true, binding=b})
`,
);

export const RESERVE_LUA = grantScript(
  "reserve",
  `
local v = redis.call('GET', KEYS[1])
if not v or v == '' then return cjson.encode({ok=false, reason='unbound'}) end
local b = cjson.decode(v)
local why = h_reserve(b, ARGV[1], ARGV[2], tonumber(ARGV[3]) or 0)
if why then return cjson.encode({ok=false, reason=why, binding=b}) end
redis.call('SET', KEYS[1], cjson.encode(b))
return cjson.encode({ok=true, binding=b})
`,
);

export const CONVERT_LUA = grantScript(
  "convert",
  `
local v = redis.call('GET', KEYS[1])
if not v or v == '' then return cjson.encode({ok=false, reason='unbound'}) end
local b = cjson.decode(v)
local why = h_convert(b, ARGV[1], tonumber(ARGV[2]) or 0)
redis.call('SET', KEYS[1], cjson.encode(b))
if why then return cjson.encode({ok=false, reason=why, binding=b}) end
return cjson.encode({ok=true, binding=b})
`,
);

export const RELEASE_LUA = grantScript(
  "release",
  `
local v = redis.call('GET', KEYS[1])
if not v or v == '' then return cjson.encode({ok=true, released=false}) end
local b = cjson.decode(v)
local did = h_release(b, ARGV[1])
if did then redis.call('SET', KEYS[1], cjson.encode(b)) end
return cjson.encode({ok=true, released=did, binding=b})
`,
);

export class UpstashGrantStore implements GrantStore {
  readonly kind = "upstash" as const;
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly prefix = storeKeys().grant,
  ) {}

  private async cmd(args: (string | number)[]): Promise<unknown> {
    const res = await fetch(this.url.replace(/\/$/, ""), {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args.map(String)),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`grant store HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error(`grant store error: ${json.error}`);
    return json.result ?? null;
  }

  private normalize(b: GrantBinding): GrantBinding {
    return normalizeBinding(b);
  }

  private async evalOne(script: string, key: string, argv: (string | number)[]): Promise<unknown> {
    return this.cmd(["EVAL", script, 1, key, ...argv]);
  }

  private parseBinding(raw: unknown): { ok: boolean; reason?: string; binding?: GrantBinding; released?: boolean } {
    if (typeof raw !== "string") throw new Error("grant store: bad EVAL result");
    const r = JSON.parse(raw) as { ok: boolean; reason?: string; binding?: GrantBinding; released?: boolean };
    return { ...r, ...(r.binding ? { binding: this.normalize(r.binding) } : {}) };
  }

  async get(txHash: string): Promise<GrantBinding | null> {
    const raw = await this.cmd(["GET", this.prefix + txHash.toLowerCase()]);
    return typeof raw === "string" ? this.normalize(JSON.parse(raw) as GrantBinding) : null;
  }

  async redeem(txHash: string, watchId: string, now: number, consume: boolean, proposal?: GrantBinding) {
    const r = this.parseBinding(
      await this.evalOne(REDEEM_LUA, this.prefix + txHash.toLowerCase(), [
        watchId,
        now,
        consume ? "1" : "0",
        proposal ? JSON.stringify(proposal) : "",
      ]),
    );
    if (r.ok && r.binding) return { ok: true as const, binding: r.binding };
    const reason = (r.reason ?? "unbound") as RedeemReason;
    return { ok: false as const, reason, ...(r.binding ? { binding: r.binding } : {}) };
  }

  async reserve(txHash: string, monitorId: string, watchId: string, now: number): Promise<ReserveResult> {
    const r = this.parseBinding(
      await this.evalOne(RESERVE_LUA, this.prefix + txHash.toLowerCase(), [monitorId, watchId, now]),
    );
    if (r.ok && r.binding) return { ok: true, binding: r.binding };
    const reason = (r.reason ?? "unbound") as GrantOpReason;
    return { ok: false, reason, ...(r.binding ? { binding: r.binding } : {}) };
  }

  async convert(txHash: string, monitorId: string, now: number): Promise<ConvertResult> {
    const r = this.parseBinding(await this.evalOne(CONVERT_LUA, this.prefix + txHash.toLowerCase(), [monitorId, now]));
    if (r.ok && r.binding) return { ok: true, binding: r.binding };
    const reason = (r.reason ?? "unbound") as "unbound" | "expired" | "exhausted";
    return { ok: false, reason, ...(r.binding ? { binding: r.binding } : {}) };
  }

  async release(txHash: string, monitorId: string): Promise<ReleaseResult> {
    const r = this.parseBinding(await this.evalOne(RELEASE_LUA, this.prefix + txHash.toLowerCase(), [monitorId]));
    return { ok: true, released: Boolean(r.released), binding: r.binding ?? null };
  }
}

type Env = Record<string, string | undefined>;

/**
 * Pick the store from env. Returns null when production has no durable store and
 * no explicit GRANT_STORE=memory opt-in: callers must then fail closed (503).
 */
export function grantStoreFromEnv(env: Env = process.env): GrantStore | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashGrantStore(url, token, storeKeys(env).grant);
  if (env.VERCEL_ENV === "production" && env.GRANT_STORE !== "memory") return null;
  return sharedMemoryStore();
}

const g = globalThis as unknown as { __harbingerGrantStore?: MemoryGrantStore };
export function sharedMemoryStore(): MemoryGrantStore {
  if (!g.__harbingerGrantStore) g.__harbingerGrantStore = new MemoryGrantStore();
  return g.__harbingerGrantStore;
}
