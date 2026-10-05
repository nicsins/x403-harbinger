import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REAL_TX = "0xc3fd6b6fbfb0da9b9412225be0e1a0bad35dde6cfd3cc2bbe585c333e85d60ef"; // 0.22 USDC, w_btc_10_1h
export const MARKET_TX = "0x72c0fb2f90b212492c4faf1253f6bced09fb6cd5e70ab7bc911948f4d9994a8d"; // 0.004 USDC marketplace settle
export const FAKE_TX = "0x" + "ab".repeat(32);
export const PAY_TO_TOPIC = "0x000000000000000000000000da1eab46918882f8656a41cf9fca80e2415369d1";
export const OTHER_TOPIC = "0x0000000000000000000000001111111111111111111111111111111111111111";
export const PAYER_TOPIC = "0x000000000000000000000000708755c5f9ec60ab416d956e1ed3c15775372b52";
export const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913".toLowerCase();
export const TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function fixture(tx: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, "fixtures", `receipt-${tx.slice(2)}.json`), "utf8"));
}

export function transferLog(atomic: number, toTopic = PAY_TO_TOPIC, address = USDC) {
  return { address, topics: [TOPIC0, PAYER_TOPIC, toTopic], data: "0x" + atomic.toString(16).padStart(64, "0") };
}

export function synthTx(n: number): string {
  return "0x" + n.toString(16).padStart(64, "0");
}

/** Mock global fetch as a Base JSON-RPC endpoint serving canned receipts. */
export function mockRpc(receipts: Record<string, unknown>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const req = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: string[] };
    if (req.method !== "eth_getTransactionReceipt") throw new Error("unexpected rpc " + req.method);
    const tx = String(req.params[0]).toLowerCase();
    calls.push(tx);
    const result = receipts[tx] ?? null;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

export function defaultReceipts(): Record<string, unknown> {
  return { [REAL_TX]: fixture(REAL_TX), [MARKET_TX]: fixture(MARKET_TX) };
}

const ENV_KEYS = [
  "VERCEL_ENV",
  "ALLOW_DEMO_GRANT",
  "GRANT_STORE",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "BASE_RPC_URL",
];
export function withEnv(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  return () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

export function resetSharedStore() {
  (globalThis as { __harbingerGrantStore?: unknown }).__harbingerGrantStore = undefined;
}
