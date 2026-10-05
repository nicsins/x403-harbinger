/**
 * Grant binding store: txHash -> { watchId, quota, used, expiresAt }.
 *
 * A record is written on the first successful redemption of a tx grant and is
 * never deleted (not even after expiry), so an expired or exhausted tx can never
 * be re-bound to a fresh watch. One small key per paid tx.
 *
 * Backends:
 * - Upstash Redis REST (Vercel Marketplace "Upstash for Redis", formerly Vercel KV).
 *   Selected when KV_REST_API_URL + KV_REST_API_TOKEN or
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. Plain fetch, no SDK.
 *   Redeem is a single Lua EVAL, so bind + check + consume is atomic across instances.
 * - In-memory (dev/preview fallback). Process-local: replay is possible across
 *   serverless instances, so production refuses it unless GRANT_STORE=memory is set
 *   explicitly (see grantStoreFromEnv).
 */

export type GrantBinding = {
  watchId: string;
  /** Total uses this tx buys on watchId. */
  quota: number;
  /** Uses consumed so far. */
  used: number;
  /** Epoch ms of first redemption. */
  boundAt: number;
  /** Epoch ms after which the grant is dead. */
  expiresAt: number;
  /** USDC atomic units (6dp) paid to payTo in the tx, as decimal string. */
  paidAtomic: string;
};

export type RedeemReason = "watch-mismatch" | "expired" | "exhausted" | "unbound";

export type RedeemResult =
  | { ok: true; binding: GrantBinding }
  | { ok: false; reason: RedeemReason; binding?: GrantBinding };

export interface GrantStore {
  readonly kind: "memory" | "upstash";
  get(txHash: string): Promise<GrantBinding | null>;
  /**
   * Atomically: if no record exists and `proposal` is given, write it; then check
   * the record against watchId / now / quota; if consume, increment `used`.
   */
  redeem(
    txHash: string,
    watchId: string,
    now: number,
    consume: boolean,
    proposal?: GrantBinding,
  ): Promise<RedeemResult>;
}

/** Pure check shared by the memory store and tests (mirrors the Lua script). */
export function applyRedeem(
  existing: GrantBinding | null,
  watchId: string,
  now: number,
  consume: boolean,
  proposal?: GrantBinding,
): { result: RedeemResult; next: GrantBinding | null } {
  const b = existing ?? (proposal ? { ...proposal } : null);
  if (!b) return { result: { ok: false, reason: "unbound" }, next: null };
  if (b.watchId !== watchId) return { result: { ok: false, reason: "watch-mismatch", binding: b }, next: b };
  if (now >= b.expiresAt) return { result: { ok: false, reason: "expired", binding: b }, next: b };
  if (consume && b.used >= b.quota) return { result: { ok: false, reason: "exhausted", binding: b }, next: b };
  const next = consume ? { ...b, used: b.used + 1 } : b;
  return { result: { ok: true, binding: next }, next };
}

export class MemoryGrantStore implements GrantStore {
  readonly kind = "memory" as const;
  private readonly map = new Map<string, GrantBinding>();

  async get(txHash: string): Promise<GrantBinding | null> {
    return this.map.get(txHash.toLowerCase()) ?? null;
  }

  async redeem(txHash: string, watchId: string, now: number, consume: boolean, proposal?: GrantBinding) {
    const key = txHash.toLowerCase();
    // Synchronous between read and write: atomic within one Node process.
    const { result, next } = applyRedeem(this.map.get(key) ?? null, watchId, now, consume, proposal);
    if (next) this.map.set(key, next);
    return result;
  }
}

const REDEEM_LUA = `
local v = redis.call('GET', KEYS[1])
local b
if v then
  b = cjson.decode(v)
elseif ARGV[4] ~= '' then
  b = cjson.decode(ARGV[4])
else
  return cjson.encode({ok=false, reason='unbound'})
end
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
  if tonumber(b.used) >= tonumber(b.quota) then
    if not v then redis.call('SET', KEYS[1], cjson.encode(b)) end
    return cjson.encode({ok=false, reason='exhausted', binding=b})
  end
  b.used = tonumber(b.used) + 1
end
redis.call('SET', KEYS[1], cjson.encode(b))
return cjson.encode({ok=true, binding=b})
`;

export class UpstashGrantStore implements GrantStore {
  readonly kind = "upstash" as const;
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly prefix = "harbinger:grant:",
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
    return {
      watchId: String(b.watchId),
      quota: Number(b.quota),
      used: Number(b.used),
      boundAt: Number(b.boundAt),
      expiresAt: Number(b.expiresAt),
      paidAtomic: String(b.paidAtomic),
    };
  }

  async get(txHash: string): Promise<GrantBinding | null> {
    const raw = await this.cmd(["GET", this.prefix + txHash.toLowerCase()]);
    return typeof raw === "string" ? this.normalize(JSON.parse(raw) as GrantBinding) : null;
  }

  async redeem(txHash: string, watchId: string, now: number, consume: boolean, proposal?: GrantBinding) {
    const raw = await this.cmd([
      "EVAL",
      REDEEM_LUA,
      1,
      this.prefix + txHash.toLowerCase(),
      watchId,
      now,
      consume ? "1" : "0",
      proposal ? JSON.stringify(proposal) : "",
    ]);
    if (typeof raw !== "string") throw new Error("grant store: bad EVAL result");
    const r = JSON.parse(raw) as { ok: boolean; reason?: RedeemReason; binding?: GrantBinding };
    const binding = r.binding ? this.normalize(r.binding) : undefined;
    if (r.ok && binding) return { ok: true as const, binding };
    return { ok: false as const, reason: r.reason ?? "unbound", ...(binding ? { binding } : {}) };
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
  if (url && token) return new UpstashGrantStore(url, token);
  if (env.VERCEL_ENV === "production" && env.GRANT_STORE !== "memory") return null;
  return sharedMemoryStore();
}

const g = globalThis as unknown as { __harbingerGrantStore?: MemoryGrantStore };
export function sharedMemoryStore(): MemoryGrantStore {
  if (!g.__harbingerGrantStore) g.__harbingerGrantStore = new MemoryGrantStore();
  return g.__harbingerGrantStore;
}
