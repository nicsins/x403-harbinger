/**
 * Base USDC grant verification, bound to one watch.
 * - hp2 (X403-HP-2): hp2.<txHash>.<unixSeconds>.<eip191Signature>. The signer must be the tx `from`.
 * - hp1 (deprecated): hp1.<txHash>. Bearer tx hash; replayable by anyone reading the chain.
 *   Accepted only until HP1_SUNSET (default DEFAULT_HP1_SUNSET).
 */
import { recoverMessageAddress } from "viem";
import { LEGACY_PAY_TO, TREASURY_ADDRESS, legacyMaxBlock } from "./treasury";
import { grantStoreFromEnv, type GrantBinding, type GrantStore } from "./grant-store";

export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Floor for watch-less crawl grants only. Watch-bound grants must pay the watch's priceUsdc. */
export const MIN_GRANT_USDC = 0.02;
export const DEMO_GRANT = "hp1.demo";
/** The only payTo ever advertised (env TREASURY_ADDRESS). */
export const PAY_TO = TREASURY_ADDRESS;
/** Legacy payTo: accepted ONLY when verifying already-settled receipts. Never advertised. */
export { LEGACY_PAY_TO };

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
const HP2_GRANT_RE = /^hp2\.(0x[a-fA-F0-9]{64})\.(\d{1,12})\.(0x[a-fA-F0-9]{130})$/i;

/** Max age (and max future skew) of an hp2 timestamp. */
export const HP2_MAX_SKEW_MS = 5 * 60 * 1000;
/** Signature nonces are remembered a little longer than the skew window. */
export const HP2_NONCE_TTL_MS = 2 * HP2_MAX_SKEW_MS;
/** Default end of the hp1 deprecation window. Override with env HP1_SUNSET (ISO date). */
export const DEFAULT_HP1_SUNSET = "2026-11-04T00:00:00Z";

export function hp1Sunset(env: Record<string, string | undefined> = process.env): number {
  const t = Date.parse(env.HP1_SUNSET || DEFAULT_HP1_SUNSET);
  return Number.isFinite(t) ? t : Date.parse(DEFAULT_HP1_SUNSET);
}

export type Hp2Grant = { txHash: string; ts: number; signature: `0x${string}` };

export function parseHp2Grant(raw: string): Hp2Grant | null {
  const m = HP2_GRANT_RE.exec(raw.trim());
  if (!m) return null;
  return { txHash: m[1]!.toLowerCase(), ts: Number(m[2]), signature: m[3]!.toLowerCase() as `0x${string}` };
}

/** Canonical route: request pathname with the internal /api prefix stripped (/api/v1/stream -> /v1/stream). */
export function canonicalRoute(pathOrUrl: string): string {
  let p = pathOrUrl;
  try {
    p = new URL(pathOrUrl, "http://x").pathname;
  } catch {
    /* keep */
  }
  p = p.replace(/\/+$/, "") || "/";
  return p.startsWith("/api/") ? p.slice(4) : p;
}

/** The exact EIP-191 (personal_sign) message an hp2 grant signs. */
export function hp2Message(txHash: string, route: string, ts: number): string {
  return `X403-HP-2 grant\ntx: ${txHash.toLowerCase()}\nroute: ${canonicalRoute(route)}\nts: ${ts}`;
}

/** Legacy crawl-path cache (watch-less isValidGrant only). Process-local. */
const seenTxGrants = new Map<string, number>();

export type GrantOpts = {
  /** Minimum USDC (human units). Defaults to MIN_GRANT_USDC. */
  minUsdc?: number;
};

/** Tx hash of an hp1 or hp2 grant (form check only, no verification). */
export function parseTxGrant(raw: string): string | null {
  const m = TX_GRANT_RE.exec(raw.trim());
  if (m) return m[1]!.toLowerCase();
  return parseHp2Grant(raw)?.txHash ?? null;
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
export type RpcReceipt = { status?: string; blockNumber?: string; from?: string; logs?: RpcLog[] };

/**
 * Recipients credited for a settled receipt: the current treasury, plus LEGACY_PAY_TO
 * (historical payments made before the switch). If LEGACY_PAY_TO_MAX_BLOCK is set,
 * legacy credit only applies to txs mined at or before that block.
 */
function creditedRecipients(receipt: RpcReceipt): string[] {
  const max = legacyMaxBlock();
  if (max !== null) {
    let bn: bigint | null = null;
    try {
      bn = receipt.blockNumber ? BigInt(receipt.blockNumber) : null;
    } catch {
      bn = null;
    }
    if (bn === null || bn > max) return [PAY_TO];
  }
  return [PAY_TO, ...LEGACY_PAY_TO];
}

/** Sum of USDC (atomic, 6dp) transferred to the treasury (or a legacy payTo, historical only) in a successful receipt. */
export function usdcPaidInReceipt(receipt: RpcReceipt | null): bigint | null {
  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) return null;
  const recipients = creditedRecipients(receipt);
  let paid = BigInt(0);
  for (const log of receipt.logs) {
    if (!log.address || !addrEq(log.address, USDC_BASE)) continue;
    const topics = log.topics ?? [];
    if (topics.length < 3) continue;
    if (!addrEq(topics[0]!, TRANSFER_TOPIC0)) continue;
    const to = topicAddress(topics[2]!);
    if (!recipients.some((r) => addrEq(to, r))) continue;
    const data = (log.data ?? "0x0").replace(/^0x/i, "") || "0";
    try {
      paid += BigInt("0x" + data);
    } catch {
      continue;
    }
  }
  return paid;
}

export async function fetchReceipt(txHash: string): Promise<RpcReceipt | null> {
  return (await rpcCall("eth_getTransactionReceipt", [txHash])) as RpcReceipt | null;
}

/** USDC paid to PAY_TO in txHash, via public Base RPC. null = no successful receipt. */
export async function usdcPaidToPayTo(txHash: string): Promise<bigint | null> {
  return usdcPaidInReceipt(await fetchReceipt(txHash));
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

  const hp2 = parseHp2Grant(g);
  const txHash = parseTxGrant(g);
  if (!txHash) return false;
  if (!hp2 && Date.now() >= hp1Sunset()) return false;
  if (hp2 && Math.abs(Date.now() - hp2.ts * 1000) > HP2_MAX_SKEW_MS) return false;

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
  | "grant-store-unavailable"
  | "grant-hp1-deprecated"
  | "grant-route-required"
  | "grant-stale"
  | "grant-bad-signature"
  | "grant-replayed";

export type GrantCheck =
  | { ok: true; kind: "demo" }
  | { ok: true; kind: "tx"; txHash: string; binding: GrantBinding }
  | { ok: false; status: 400 | 403 | 503; reason: GrantDenyReason; txHash?: string; binding?: GrantBinding };

export type CheckGrantOpts = {
  /** Count this request against quota. Stream and hooks pass true only when a ping fires. */
  consume: boolean;
  now?: number;
  /** Override for tests. Default: grantStoreFromEnv(). */
  store?: GrantStore | null;
  /** Request route (pathname). Required for hp2: the signature covers it. */
  route?: string;
  /**
   * Server-side recheck of a grant that was already authenticated when its monitor
   * opened (notify pump). Skips the hp2 signature and the hp1 sunset; binding, TTL
   * and quota still apply.
   */
  internal?: boolean;
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
  const hp2 = isDemo ? null : parseHp2Grant(g);
  const txHash = isDemo ? null : parseTxGrant(g);
  if (!isDemo && !txHash) return deny(403, "grant-required");

  if (!watchIdRaw || !watchIdRaw.trim()) return deny(400, "watch-required");
  if (!watch) return deny(400, "unknown-watch");

  if (isDemo) return { ok: true, kind: "demo" };
  const tx = txHash!;

  const store = opts.store === undefined ? grantStoreFromEnv() : opts.store;
  if (!store) return deny(503, "grant-store-unavailable", { txHash: tx });
  const now = opts.now ?? Date.now();

  if (!opts.internal) {
    if (!hp2 && now >= hp1Sunset()) return deny(403, "grant-hp1-deprecated", { txHash: tx });
    if (hp2) {
      if (!opts.route) return deny(403, "grant-route-required", { txHash: tx });
      // Cheap checks first: no RPC is spent on a stale or future-dated grant.
      if (Math.abs(now - hp2.ts * 1000) > HP2_MAX_SKEW_MS) return deny(403, "grant-stale", { txHash: tx });
    }
  }

  try {
    let existing = await store.get(tx);
    let proposal: GrantBinding | undefined;
    let receipt: RpcReceipt | null | undefined;
    if (hp2 && !opts.internal) {
      receipt = await fetchReceipt(tx);
      const from = receipt?.from;
      if (!from) return deny(403, "grant-required", { txHash: tx });
      let signer: string;
      try {
        signer = await recoverMessageAddress({ message: hp2Message(tx, opts.route!, hp2.ts), signature: hp2.signature });
      } catch {
        return deny(403, "grant-bad-signature", { txHash: tx });
      }
      if (!addrEq(signer, from)) return deny(403, "grant-bad-signature", { txHash: tx });
      // One request per signed header: a captured hp2 header cannot be replayed.
      const fresh = await store.claimNonce(`${tx}:${hp2.signature}`, HP2_NONCE_TTL_MS);
      if (!fresh) return deny(403, "grant-replayed", { txHash: tx });
    }
    if (!existing) {
      const paid = receipt !== undefined ? usdcPaidInReceipt(receipt) : await usdcPaidToPayTo(tx);
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
    scheme: "hp2",
    document: "X403-HP-2",
    form: "hp2.<BaseTxHash>.<unixSeconds>.<eip191Signature>",
    header,
    signature: {
      type: "EIP-191 personal_sign",
      signer: "must equal the tx `from` address",
      message: "X403-HP-2 grant\\ntx: <txHash lowercase>\\nroute: <request path, e.g. /v1/stream>\\nts: <unixSeconds>",
      maxSkewSeconds: HP2_MAX_SKEW_MS / 1000,
      singleUse: "each signed header is accepted once",
    },
    deprecated: {
      scheme: "hp1",
      form: "hp1.<BaseTxHash>",
      reason: "a public tx hash is replayable by anyone reading the chain",
      acceptedUntil: new Date(hp1Sunset()).toISOString(),
    },
    demo: DEMO_GRANT,
    demo_note: "demo_reference_only",
    demo_production: "rejected",
    network: "eip155:8453",
    asset: "USDC",
    payTo: PAY_TO,
    usdc: USDC_BASE,
    binding: "first-watch",
    billing: "per-ping: each fired ping consumes one paid use",
    value: "USDC Transfer(s) to payTo in the tx must total >= the watch priceUsdc",
    policy: {
      "per-ping": `floor(paid/price) pings, max ${GRANT_POLICY["per-ping"].maxUses}, expire ${GRANT_POLICY["per-ping"].ttlMs / HOUR_MS}h after first use`,
      session: `${GRANT_POLICY.session.ttlMs / HOUR_MS}h from first use, fair-use cap ${GRANT_POLICY.session.maxUses} requests`,
    },
  };
}
