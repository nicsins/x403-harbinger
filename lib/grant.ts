/** Base USDC grant verification for hp1.<txHash>. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const MIN_GRANT_USDC = 0.02;
export const DEMO_GRANT = "hp1.demo";
export const PAY_TO = "0xDa1Eab46918882f8656a41cF9fCa80e2415369d1";

/** Prod rejects demo unless ALLOW_DEMO_GRANT=1. Preview/dev keep demo for UI pages. */
export function allowDemoGrant(): boolean {
  if (process.env.ALLOW_DEMO_GRANT === "1") return true;
  if (process.env.VERCEL_ENV === "production") return false;
  return true;
}

const TX_GRANT_RE = /^hp1\.(0x[a-fA-F0-9]{64})$/i;

/** Known gap v1: process-local only; double-spend across instances possible. */
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

function usdcAtomic(human: number): bigint {
  return BigInt(Math.round(human * 1e6));
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const url = process.env.BASE_RPC_URL || "https://mainnet.base.org";
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
}

type RpcLog = { address?: string; topics?: string[]; data?: string };
type RpcReceipt = { status?: string; logs?: RpcLog[] };

/** Verify a Base USDC Transfer to PAY_TO for at least minUsdc. */
export async function verifyBaseUsdcGrant(txHash: string, minUsdc: number): Promise<boolean> {
  const receipt = (await rpcCall("eth_getTransactionReceipt", [txHash])) as RpcReceipt | null;
  if (!receipt || receipt.status !== "0x1" || !Array.isArray(receipt.logs)) return false;

  const need = usdcAtomic(minUsdc);
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
  return paid >= need;
}

/**
 * Async grant gate.
 * - Non-prod / ALLOW_DEMO_GRANT=1: accepts hp1.demo
 * - Prod: rejects hp1.demo and arbitrary hp1.*; accepts only hp1.<BaseTxHash>
 *   verified via public Base RPC (USDC Transfer -> PAY_TO, value >= minUsdc).
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
  };
}
