import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { checkGrant, hp2Message, canonicalRoute, parseTxGrant, type GrantWatch } from "../lib/grant";
import { MemoryGrantStore } from "../lib/grant-store";
import { synthTx, transferLog, mockRpc, withEnv, addrTopic, PAY_TO_TOPIC, USDC } from "./helpers";

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
  // Mocked chain: a settled 0.44 USDC transfer to payTo from `payer` (EOA).
  rpc = mockRpc({ [TX]: { status: "0x1", blockNumber: "0x1", from: payer.address.toLowerCase(), logs: [transferLog(440000, PAY_TO_TOPIC, USDC, addrTopic(payer.address))] } });
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
  test("EOA: valid signature from the payer -> ok, bills one ping", async () => {
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

describe("hp2 signer = USDC payer (smart wallets)", () => {
  const BUNDLER = "0x54e2acab04c89a3fe02852bf8dd69ee8f526bc75";
  const ENTRYPOINT = "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";
  const SW = "0x0b625beb5587af718d90d1e838b0b0df20e434d3"; // smart wallet contract (mock)
  const owner = privateKeyToAccount(generatePrivateKey());
  const BTX = synthTx(0xb0b);
  let rpc2: ReturnType<typeof mockRpc>;
  const r2 = (raw: string) =>
    checkGrant(raw, W10.id, W10, { consume: true, now: NOW, route: ROUTE, store: new MemoryGrantStore() });
  const sigFor = (who: { signMessage: (a: { message: string }) => Promise<string> }, tx = BTX) =>
    who.signMessage({ message: hp2Message(tx, ROUTE, sec(NOW)) });
  // Mock chain: SW is a contract whose isValidSignature accepts only `owner`'s signatures.
  let ownerSig = "";
  const chain = (method: string, params: unknown[]) => {
    if (method === "eth_getCode") return String((params[0] as string) ?? "").toLowerCase() === SW ? "0x6080" : "0x";
    if (method === "eth_call") {
      const data = JSON.stringify(params).toLowerCase();
      const ok = ownerSig !== "" && data.includes(SW.slice(2)) && data.includes(ownerSig.slice(2).toLowerCase());
      return "0x" + (ok ? "1" : "0").padStart(64, "0");
    }
    if (method === "eth_chainId") return "0x2105";
    throw new Error("unexpected rpc " + method);
  };
  beforeEach(async () => {
    rpc.restore();
    rpc2 = mockRpc(
      {
        // Bundled 4337 tx: tx.from is the bundler, to is the EntryPoint, the payer is the smart wallet.
        [BTX]: { status: "0x1", blockNumber: "0x1", from: BUNDLER, to: ENTRYPOINT, logs: [transferLog(220000, PAY_TO_TOPIC, USDC, addrTopic(SW))] },
        [TX]: { status: "0x1", blockNumber: "0x1", from: BUNDLER, to: ENTRYPOINT, logs: [transferLog(440000, PAY_TO_TOPIC, USDC, addrTopic(payer.address))] },
      },
      chain,
    );
  });
  afterEach(() => { rpc2.restore(); ownerSig = ""; });

  test("bundled tx, EOA payer: payer signature ok even though tx.from is the bundler", async () => {
    assert.equal(why(await r2(`hp2.${TX}.${sec(NOW)}.${await sigFor(payer, TX)}`)), "ok");
  });
  test("bundled tx: a signature from the bundler or a stranger is rejected", async () => {
    assert.equal(why(await r2(`hp2.${TX}.${sec(NOW)}.${await sigFor(other, TX)}`)), "403 grant-bad-signature");
  });
  test("ERC-1271 smart wallet payer: valid isValidSignature -> ok", async () => {
    ownerSig = await sigFor(owner);
    assert.equal(why(await r2(`hp2.${BTX}.${sec(NOW)}.${ownerSig}`)), "ok");
  });
  test("ERC-1271 smart wallet payer: contract rejects -> grant-bad-signature", async () => {
    ownerSig = await sigFor(owner);
    assert.equal(why(await r2(`hp2.${BTX}.${sec(NOW)}.${await sigFor(other)}`)), "403 grant-bad-signature");
  });
  test("long smart-wallet signatures (6492-wrapped size) parse", async () => {
    const long = "0x" + "ab".repeat(700);
    assert.equal(parseTxGrant(`hp2.${BTX}.${sec(NOW)}.${long}`), BTX);
  });
  test("stale still checked first for smart wallets (no RPC)", async () => {
    const before = rpc2.calls.length;
    assert.equal(why(await r2(`hp2.${BTX}.${sec(NOW) - 400}.${await sigFor(owner)}`)), "403 grant-stale");
    assert.equal(rpc2.calls.length, before);
  });
  test("payer who paid under the price is not an accepted signer", async () => {
    const UTX = synthTx(0xb0c);
    rpc2.restore();
    rpc2 = mockRpc({ [UTX]: { status: "0x1", blockNumber: "0x1", from: BUNDLER, logs: [transferLog(100000, PAY_TO_TOPIC, USDC, addrTopic(payer.address))] } }, chain);
    assert.equal(why(await r2(`hp2.${UTX}.${sec(NOW)}.${await sigFor(payer, UTX)}`)), "403 insufficient-payment");
  });
});
