import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkGrant, hp2Message, canonicalRoute, parseTxGrant, type GrantWatch } from "../lib/grant";
import { MemoryGrantStore } from "../lib/grant-store";
import { synthTx, transferLog, mockRpc, withEnv } from "./helpers";

// Throwaway keys generated per run. Never a real wallet.
const payer = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const W10: GrantWatch = { id: "w_btc_10_1h", priceUsdc: 0.22, billing: "per-ping" };
const TX = synthTx(0x4802);
const ROUTE = "/v1/patrol";
const NOW = Date.parse("2026-10-21T23:00:00Z");
const sec = (ms: number) => Math.floor(ms / 1000);

async function hp2(signer = payer, ts = sec(NOW), route = ROUTE, tx = TX) {
  const sig = await signer.signMessage({ message: hp2Message(tx, route, ts) });
  return `hp2.${tx}.${ts}.${sig}`;
}

let rpc: ReturnType<typeof mockRpc>;
let restore: () => void;
let store: MemoryGrantStore;
beforeEach(() => {
  restore = withEnv({ VERCEL_ENV: "production", HP1_SUNSET: undefined });
  // Mocked chain: a settled 0.44 USDC transfer to payTo sent by `payer`.
  rpc = mockRpc({ [TX]: { status: "0x1", blockNumber: "0x1", from: payer.address.toLowerCase(), logs: [transferLog(440000)] } });
  store = new MemoryGrantStore();
});
afterEach(() => { rpc.restore(); restore(); });

const run = (raw: string, o: { now?: number; route?: string; consume?: boolean } = {}) =>
  checkGrant(raw, W10.id, W10, { consume: o.consume ?? true, now: o.now ?? NOW, route: o.route ?? ROUTE, store });
const why = (r: Awaited<ReturnType<typeof run>>) => (r.ok ? "ok" : `${r.status} ${r.reason}`);

describe("X403-HP-2 signed grants", () => {
  test("form + canonical route", async () => {
    assert.equal(parseTxGrant(await hp2()), TX);
    assert.equal(canonicalRoute("https://h.example/api/v1/stream?watch=x"), "/v1/stream");
  });
  test("valid signature from tx sender -> ok, bills one ping", async () => {
    const r = await run(await hp2());
    assert.equal(why(r), "ok");
    assert.equal(r.ok && r.kind === "tx" && r.binding.used, 1);
    assert.equal(r.ok && r.kind === "tx" && r.binding.quota, 2);
  });
  test("wrong signer -> 403 grant-bad-signature, nothing bound", async () => {
    assert.equal(why(await run(await hp2(other))), "403 grant-bad-signature");
    assert.equal(await store.get(TX), null);
  });
  test("signature for another route -> 403 grant-bad-signature", async () => {
    assert.equal(why(await run(await hp2(payer, sec(NOW), "/v1/stream"))), "403 grant-bad-signature");
  });
  test("stale (>5 min) and future timestamps -> 403 grant-stale, no RPC", async () => {
    assert.equal(why(await run(await hp2(payer, sec(NOW) - 301))), "403 grant-stale");
    assert.equal(why(await run(await hp2(payer, sec(NOW) + 301))), "403 grant-stale");
    assert.equal(rpc.calls.length, 0);
    assert.equal(why(await run(await hp2(payer, sec(NOW) - 240))), "ok");
  });
  test("replay of the same signed header -> 403 grant-replayed; fresh signature ok", async () => {
    const h = await hp2();
    assert.equal(why(await run(h)), "ok");
    assert.equal(why(await run(h)), "403 grant-replayed");
    assert.equal(why(await run(await hp2(payer, sec(NOW) + 1), { now: NOW + 1000 })), "ok");
  });
  test("per-ping quota still applies: 0.44 at 0.22 buys exactly 2 pings", async () => {
    assert.equal(why(await run(await hp2(payer, sec(NOW)))), "ok");
    assert.equal(why(await run(await hp2(payer, sec(NOW) + 1), { now: NOW + 1000 })), "ok");
    assert.equal(why(await run(await hp2(payer, sec(NOW) + 2), { now: NOW + 2000 })), "403 grant-exhausted");
  });
  test("tx with no receipt -> 403 grant-required", async () => {
    assert.equal(why(await run(await hp2(payer, sec(NOW), ROUTE, synthTx(0xdead)))), "403 grant-required");
  });
  test("hp2 without route -> 403 grant-route-required", async () => {
    const r = await checkGrant(await hp2(), W10.id, W10, { consume: true, now: NOW, store });
    assert.equal(why(r), "403 grant-route-required");
  });
});

describe("hp1 deprecation window", () => {
  const h1 = `hp1.${TX}`;
  test("hp1 accepted before default sunset", async () => {
    assert.equal(why(await run(h1, { now: Date.parse("2026-11-03T23:59:00Z") })), "ok");
  });
  test("hp1 rejected at/after default sunset", async () => {
    assert.equal(why(await run(h1, { now: Date.parse("2026-11-04T00:00:00Z") })), "403 grant-hp1-deprecated");
  });
  test("HP1_SUNSET env overrides", async () => {
    const r2 = withEnv({ HP1_SUNSET: "2026-10-01T00:00:00Z" });
    try {
      assert.equal(why(await run(h1)), "403 grant-hp1-deprecated");
    } finally { r2(); }
  });
  test("internal recheck (notify pump) unaffected by sunset", async () => {
    await run(h1, { consume: false, now: Date.parse("2026-11-03T20:00:00Z") });
    const r = await checkGrant(h1, W10.id, W10, { consume: false, now: Date.parse("2026-11-04T06:00:00Z"), store, internal: true });
    assert.equal(why(r), "ok");
  });
});
