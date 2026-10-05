/** Base USDC grant verification for hp1.<txHash>, bound to one watch. */
import { grantStoreFromEnv, type GrantBinding, type GrantStore } from "./grant-store";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Floor for watch-less crawl grants only. Watch-bound grants must pay the watch's priceUsdc. */
export const MIN_GRANT_USDC = 0.02;
export const DEMO_GRANT = "hp1.demo";
export const PAY_TO = "0xDa1Eab46918882f8656a41cF9fCa80e2415369d1";

const HOUR_MS = 60 * 60 * 1000;

/**
 * PROPOSED grant policy (needs Nic's sign-off before deploy).
 *
 * SPEC §10: per-ping = charge when the watch fires; session = one grant covers a
 * period, pings included. A tx is bound to the first watch it is redeemed on.
 *
 * - per-ping: one ping per priceUsdc paid: uses = floor(paid / price), capped at
 *   maxUses (so one large settle can't mint an unbounded run). An exact-price
 *   payment buys exactly 1 ping. Unused pings expire ttlMs after first redemption.
 * - session: one grant covers ttlMs (24h) from first redemption; fair-use cap of
 *   maxUses requests (288 = one per 5 min over 24h).
 *
 * Records are kept after expiry (see grant-store.ts) so a tx is never re-bindable.
 */
export const GRANT_POLICY = {
  "per-ping": { ttlMs: 24 * HOUR_MS, maxUses: 10 },
  session: { ttlMs: 24 * HOUR_MS, maxUses: 288 },
} as const;

/** Prod rejects demo unless ALLOW_DEMO_GRANT=1. Preview/dev keep demo for UI pages. */
export function allowDemoGrant(): boolean {
  if (process.env.ALLOW_DEMO_GRANT === "1") return true;
  if (process.env.VERCEL_ENV === "production") return false;
  return true;
}

const TX_GRANT_RE = /^hp1\.(0x[a-fA-F0-9]{64})$/i;

/** Legacy crawl-path cache (watch-less isValidGrant only). Process-local. */
const seenTxGrants = new Map<string, number>();

export type GrantOpts = {
  /** Minimum USDC (human units). Defaults to MIN_GRANT_USDC. */
  minUsdc?: number;
};

export function parseTxGrant(raw: string): string | null {
  const m = TX_GRANT_RE.exec(raw.trim());
  return m ? m[1]!.toLowerCase() : null;
}

function addrEq(a: string, b: string): boolean {
  return a.replace(/^0x/i, "").toLowerCase() === b.replace(/^0x/i, "").toLowerCase();
}

function topicAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

export function usdcAtomic(human: number): bigint {
  return BigInt(Math.round(human * 1e6));
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const url = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown; error?: unknown };
    if (json.error) return null;
    return json.result ?? null;
  } catch {
    return null;
  }
}

type RpcLog = { address?: string; topics?: string[]; data?: string };
export type RpcReceipt = { status?: string; logs?: RpcLog[] };

/** Sum of USDC (atomic, 6dp) transferred to PAY_TO in a successful receipt. */
export function usdcPaidInReceipt(receipt: RpcReceipt | null): bigint | null {
  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) return null;
  let paid = BigInt(0);
  for (const log of receipt.logs) {
    if (!log.address || !addrEq(log.address, USDC_BASE)) continue;
    const topics = log.topics ?? [];
    if (topics.length < 3) continue;
    if (!addrEq(topics[0]!, TRANSFER_TOPIC0)) continue;
    if (!addrEq(topicAddress(topics[2]!), PAY_TO)) continue;
    const data = (log.data ?? "0x0").replace(/^0x/i, "") || "0";
    try {
      paid += BigInt("0x" + data);
    } catch {
      continue;
    }
  }
  return paid;
}

/** USDC paid to PAY_TO in txHash, via public Base RPC. null = no successful receipt. */
export async function usdcPaidToPayTo(txHash: string): Promise<bigint | null> {
  const receipt = (await rpcCall("eth_getTransactionReceipt", [txHash])) as RpcReceipt | null;
  return usdcPaidInReceipt(receipt);
}

/** Verify a Base USDC Transfer to PAY_TO for at least minUsdc. */
export async function verifyBaseUsdcGrant(txHash: string, minUsdc: number): Promise<boolean> {
  const paid = await usdcPaidToPayTo(txHash);
  return paid !== null && paid > BigInt(0) && paid >= usdcAtomic(minUsdc);
}

/**
 * Legacy watch-less check. Only for crawl-flag gates on otherwise-public listings
 * (/v1/watches, /v1/index with X-Harbinger-Crawl: 1). Does not bind or consume.
 * Watch-bound paths (stream, hooks, patrol, agentmail send) must use checkGrant.
 */
export async function isValidGrant(
  raw: string | null | undefined,
  opts?: GrantOpts,
): Promise<boolean> {
  if (!raw) return false;
  const g = raw.trim();
  if (g === DEMO_GRANT) return allowDemoGrant();

  const txHash = parseTxGrant(g);
  if (!txHash) return false;

  const minUsdc = opts?.minUsdc ?? MIN_GRANT_USDC;
  if (seenTxGrants.has(txHash)) return true;

  const ok = await verifyBaseUsdcGrant(txHash, minUsdc);
  if (ok) seenTxGrants.set(txHash, Date.now());
  return ok;
}

export type GrantWatch = { id: string; priceUsdc: number; billing: "per-ping" | "session" };

export function grantQuota(watch: GrantWatch, paidAtomic: bigint): number {
  const policy = GRANT_POLICY[watch.billing];
  if (watch.billing === "session") return policy.maxUses;
  const price = usdcAtomic(watch.priceUsdc);
  if (price <= BigInt(0)) return 0;
  const n = Number(paidAtomic / price);
  return Math.max(0, Math.min(n, policy.maxUses));
}

export type GrantDenyReason =
  | "grant-required"
  | "insufficient-payment"
  | "grant-bound-to-other-watch"
  | "grant-expired"
  | "grant-exhausted"
  | "watch-required"
  | "unknown-watch"
  | "grant-store-unavailable";

export type GrantCheck =
  | { ok: true; kind: "demo" }
  | { ok: true; kind: "tx"; txHash: string; binding: GrantBinding }
  | { ok: false; status: 400 | 403 | 503; reason: GrantDenyReason; txHash?: string; binding?: GrantBinding };

export type CheckGrantOpts = {
  /** Count this request against quota. Stream polls and hook registration pass false.
 *  A fired delivery, patrol, and agentmail send pass true. No-move never consumes. */
  consume: boolean;
  now?: number;
  /** Override for tests. Default: grantStoreFromEnv(). */
  store?: GrantStore | null;
};

const deny = (
  status: 400 | 403 | 503,
  reason: GrantDenyReason,
  extra?: { txHash?: string; binding?: GrantBinding },
): GrantCheck => ({ ok: false, status, reason, ...extra });

/**
 * Watch-bound grant gate.
 * Order: no/garbage/demo-on-prod grant -> 403 (unchanged, SPEC §3);
 * well-formed grant but missing/unknown watch -> 400;
 * tx grant -> bound to first watch, value >= watch price, TTL + quota -> 200 or 403.
 */
export async function checkGrant(
  raw: string | null | undefined,
  watchIdRaw: string | null | undefined,
  watch: GrantWatch | null,
  opts: CheckGrantOpts,
): Promise<GrantCheck> {
  const g = (raw ?? "").trim();
  if (!g) return deny(403, "grant-required");

  const isDemo = g === DEMO_GRANT;
  if (isDemo && !allowDemoGrant()) return deny(403, "grant-required");
  const txHash = isDemo ? null : parseTxGrant(g);
  if (!isDemo && !txHash) return deny(403, "grant-required");

  if (!watchIdRaw || !watchIdRaw.trim()) return deny(400, "watch-required");
  if (!watch) return deny(400, "unknown-watch");

  if (isDemo) return { ok: true, kind: "demo" };
  const tx = txHash!;

  const store = opts.store === undefined ? grantStoreFromEnv() : opts.store;
  if (!store) return deny(503, "grant-store-unavailable", { txHash: tx });
  const now = opts.now ?? Date.now();

  try {
    let existing = await store.get(tx);
    let proposal: GrantBinding | undefined;
    if (!existing) {
      const paid = await usdcPaidToPayTo(tx);
      if (paid === null || paid <= BigInt(0)) return deny(403, "grant-required", { txHash: tx });
      if (paid < usdcAtomic(watch.priceUsdc)) return deny(403, "insufficient-payment", { txHash: tx });
      const policy = GRANT_POLICY[watch.billing];
      proposal = {
        watchId: watch.id,
        quota: grantQuota(watch, paid),
        used: 0,
        boundAt: now,
        expiresAt: now + policy.ttlMs,
        paidAtomic: paid.toString(),
      };
    }
    const r = await store.redeem(tx, watch.id, now, opts.consume, proposal);
    if (r.ok) return { ok: true, kind: "tx", txHash: tx, binding: r.binding };
    const reason: GrantDenyReason =
      r.reason === "watch-mismatch"
        ? "grant-bound-to-other-watch"
        : r.reason === "expired"
          ? "grant-expired"
          : r.reason === "exhausted"
            ? "grant-exhausted"
            : "grant-required";
    return deny(403, reason, { txHash: tx, ...(r.binding ? { binding: r.binding } : {}) });
  } catch {
    return deny(503, "grant-store-unavailable", { txHash: tx });
  }
}

export function grantAdvert(header: string) {
  return {
    scheme: "hp1",
    form: "hp1.<BaseTxHash>",
    header,
    demo: DEMO_GRANT,
    demo_note: "demo_reference_only",
    demo_production: "rejected",
    network: "eip155:8453",
    asset: "USDC",
    payTo: PAY_TO,
    usdc: USDC_BASE,
    binding: "first-watch",
    value: "USDC Transfer(s) to payTo in the tx must total >= the watch priceUsdc",
    policy: {
      "per-ping": `floor(paid/price) pings, max ${GRANT_POLICY["per-ping"].maxUses}, expire ${GRANT_POLICY["per-ping"].ttlMs / HOUR_MS}h after first use`,
      session: `${GRANT_POLICY.session.ttlMs / HOUR_MS}h from first use, fair-use cap ${GRANT_POLICY.session.maxUses} requests`,
    },
  };
}
