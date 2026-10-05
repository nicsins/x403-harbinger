import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as streamGET } from "../app/api/v1/stream/route";
import { POST as hooksPOST } from "../app/api/v1/hooks/route";
import { POST as patrolPOST } from "../app/api/v1/patrol/route";
import { POST as mailPOST } from "../app/api/v1/agentmail/route";
import { REAL_TX, MARKET_TX, FAKE_TX, mockRpc, defaultReceipts, withEnv, resetSharedStore } from "./helpers";
import { sharedMemoryStore } from "../lib/grant-store";

const BASE = "https://www.x403-harbinger.com";
const stream = (headers: Record<string, string>, qs = "") =>
  streamGET(new Request(`${BASE}/v1/stream${qs}`, { headers: { accept: "application/json", ...headers } }));
const hooks = (headers: Record<string, string>, body: unknown = {}) =>
  hooksPOST(new Request(`${BASE}/v1/hooks`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const G = (tx: string) => ({ "X-Harbinger-Grant": `hp1.${tx}` });
const W = (id: string) => ({ "X-Harbinger-Watch": id });

let rpc: ReturnType<typeof mockRpc>;
let restoreEnv: () => void;
beforeEach(() => {
  // Production semantics, with the in-memory store explicitly opted in for tests.
  restoreEnv = withEnv({ VERCEL_ENV: "production", GRANT_STORE: "memory" });
  resetSharedStore();
  rpc = mockRpc(defaultReceipts());
});
afterEach(() => {
  rpc.restore();
  restoreEnv();
  resetSharedStore();
});

describe("GET /v1/stream", () => {
  test("unpaid + watch -> 403 grant-required challenge", async () => {
    const r = await stream(W("w_btc_10_1h"));
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("X-Harbinger-Forbidden"), "grant-required");
    assert.equal(r.headers.get("X-Harbinger-Price"), "0.22 USDC");
  });
  test("unpaid, no watch -> 403 (unchanged)", async () => {
    assert.equal((await stream({})).status, 403);
  });
  test("hp1.demo on prod -> 403", async () => {
    assert.equal((await stream({ "X-Harbinger-Grant": "hp1.demo", ...W("w_btc_10_1h") })).status, 403);
  });
  test("fake 64-hex -> 403", async () => {
    assert.equal((await stream({ ...G(FAKE_TX), ...W("w_btc_10_1h") })).status, 403);
  });
  test("valid grant, no watch -> 400 watch-required (gap 3)", async () => {
    const r = await stream(G(REAL_TX));
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "watch-required");
  });
  test("valid grant, unknown watch -> 400 unknown-watch", async () => {
    const r = await stream({ ...G(REAL_TX), ...W("w_does_not_exist") });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, "unknown-watch");
  });
  test("real grant arms w_btc_10_1h without spending, then another watch is 403", async () => {
    const ok = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as {
      status: string;
      watchId: string;
      settleTx: string;
      firedAt: null;
      correlation: number | null;
      grant: { used: number; quota: number };
      monitorId: string;
    };
    assert.equal(body.status, "pending");
    assert.equal(body.watchId, "w_btc_10_1h");
    assert.equal(body.settleTx, REAL_TX);
    assert.equal(body.firedAt, null);
    assert.equal(body.correlation, null);
    assert.notEqual(body.correlation, 0.99);
    assert.deepEqual([body.grant.used, body.grant.quota], [0, 1]);

    const again = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(again.status, 200);
    const replay = (await again.json()) as { status: string; monitorId: string; grant: { used: number } };
    assert.equal(replay.status, "pending");
    assert.equal(replay.monitorId, body.monitorId);
    assert.equal(replay.grant.used, 0);

    const other = await stream({ ...G(REAL_TX), ...W("w_btc_5_1h") });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get("X-Harbinger-Forbidden"), "grant-bound-to-other-watch");
  });
  test("?watch= query still names the watch", async () => {
    assert.equal((await stream(G(REAL_TX), "?watch=w_btc_10_1h")).status, 200);
  });
  test("marketplace 0.004 settle -> 403 insufficient-payment on the cheapest watch", async () => {
    const r = await stream({ ...G(MARKET_TX), ...W("w_mail_otp") });
    assert.equal(r.status, 403);
    assert.equal(r.headers.get("X-Harbinger-Forbidden"), "insufficient-payment");
  });
  test("prod without durable store -> 503 for tx grants; demo/unpaid still 403", async () => {
    restoreEnv();
    restoreEnv = withEnv({ VERCEL_ENV: "production" });
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 503);
    assert.equal((await stream({ "X-Harbinger-Grant": "hp1.demo", ...W("w_btc_10_1h") })).status, 403);
    assert.equal((await stream(W("w_btc_10_1h"))).status, 403);
  });
  test("dev/preview: demo + watch -> 200, demo without watch -> 400", async () => {
    restoreEnv();
    restoreEnv = withEnv({});
    assert.equal((await stream({ "X-Harbinger-Grant": "hp1.demo", ...W("w_eth_funding") })).status, 200);
    assert.equal((await stream({ "X-Harbinger-Grant": "hp1.demo" })).status, 400);
  });
});

describe("POST /v1/hooks", () => {
  test("unpaid + watch header (marketplace try/notify shape) -> 403 grant-required", async () => {
    const r = await hooks(W("w_eth_btc_join"));
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { forbidden: "grant-required" });
  });
  test("hp1.demo on prod -> 403", async () => {
    assert.equal((await hooks({ "X-Harbinger-Grant": "hp1.demo" })).status, 403);
  });
  test("valid grant, no watch -> 400", async () => {
    assert.equal((await hooks(G(REAL_TX))).status, 400);
  });
  test("valid grant, unknown watchId in body -> 400", async () => {
    assert.equal((await hooks(G(REAL_TX), { watchId: "w_nope" })).status, 400);
  });
  test("hook registration does not consume; a spent grant is still refused", async () => {
    const a = await hooks({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    assert.equal(a.status, 200);
    assert.deepEqual(await a.json(), { protocol: "x403-HARBINGER/1.0", accepted: true, watchId: "w_eth_btc_join" });
    const again = await hooks({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    assert.equal(again.status, 200);
    const armed = await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    assert.equal(armed.status, 200);
    assert.equal(((await armed.json()) as { grant: { used: number } }).grant.used, 0);

    // A pending ping holds the grant: patrol is refused before it can spend.
    const patrol = await patrolPOST(new Request(`${BASE}/v1/patrol`, { method: "POST", headers: { ...G(REAL_TX), ...W("w_eth_btc_join") } }));
    assert.equal(patrol.status, 409);
    assert.equal(patrol.headers.get("X-Harbinger-Forbidden"), "grant-reserved");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
    // Spend the unit another way (agentmail send shares the gate).
    const sent = await mailPOST(new Request(`${BASE}/v1/rails/agentmail`, { method: "POST", headers: { ...G(REAL_TX), "content-type": "application/json" }, body: JSON.stringify({ action: "send", watchId: "w_eth_btc_join" }) }));
    assert.equal(sent.status, 200);
    const exhausted = await hooks({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    assert.equal(exhausted.status, 403);
    assert.equal(exhausted.headers.get("X-Harbinger-Forbidden"), "grant-exhausted");
    const repeat = await hooks({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    assert.equal(repeat.status, 403);
    assert.equal(repeat.headers.get("X-Harbinger-Forbidden"), "grant-exhausted");
  });
  test("hook registration rejects a grant bound to another watch", async () => {
    assert.equal((await hooks({ ...G(REAL_TX), ...W("w_eth_btc_join") })).status, 200);
    const other = await hooks({ ...G(REAL_TX), ...W("w_fx_dollar_bid") });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get("X-Harbinger-Forbidden"), "grant-bound-to-other-watch");
  });
  test("price check uses the requested watch", async () => {
    const r = await hooks(G(MARKET_TX), { watchId: "w_btc_whale" });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { forbidden: "insufficient-payment" });
  });
  test("watch without a webhook rail -> 400 hook-not-supported-for-watch before any grant check", async () => {
    for (const [headers, body] of [
      [{ ...G(REAL_TX), ...W("w_mail_otp") }, { callback: "https://example.com/h" }],
      [G(REAL_TX), { watchId: "w_btc_10_1h", callback: "https://example.com/h" }],
      [W("w_mail_otp"), {}],
      [{ "X-Harbinger-Grant": "hp1.demo", ...W("w_mail_otp") }, {}],
    ] as const) {
      const r = await hooks(headers as Record<string, string>, body);
      assert.equal(r.status, 400);
      assert.equal(((await r.json()) as { error: string }).error, "hook-not-supported-for-watch");
    }
    assert.equal(rpc.calls.length, 0);
    assert.equal(await sharedMemoryStore().get(REAL_TX), null);
    // The grant was never bound, so it still arms its own watch.
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 200);
  });
});

describe("patrol + agentmail send share the gate", () => {
  test("patrol unpaid 403; demo 403 on prod; patrol spends, replay 403", async () => {
    const p = (h: Record<string, string>) => patrolPOST(new Request(`${BASE}/v1/patrol`, { method: "POST", headers: h }));
    assert.equal((await p({})).status, 403);
    assert.equal((await p({ "X-Harbinger-Grant": "hp1.demo" })).status, 403);
    assert.equal((await p(G(REAL_TX))).status, 200);
    assert.equal((await p(G(REAL_TX))).status, 403);
    assert.equal((await p({ ...G(REAL_TX), ...W("w_btc_5_1h") })).status, 403);
  });
  test("patrol vs pending: 409 grant-reserved while a ping is pending, nothing spent", async () => {
    const p = (h: Record<string, string>) => patrolPOST(new Request(`${BASE}/v1/patrol`, { method: "POST", headers: h }));
    const armed = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(armed.status, 200);
    const r = await p(G(REAL_TX));
    assert.equal(r.status, 409);
    const body = (await r.json()) as { error: string; monitorId: string };
    assert.equal(body.error, "grant-reserved");
    assert.ok(body.monitorId);
    assert.equal((await p({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 409);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
  });
  test("agentmail send: missing watch 400, replay 403", async () => {
    const send = (body: Record<string, unknown>) =>
      mailPOST(new Request(`${BASE}/v1/rails/agentmail`, { method: "POST", headers: { ...G(REAL_TX), "content-type": "application/json" }, body: JSON.stringify({ action: "send", ...body }) }));
    assert.equal((await send({})).status, 400);
    assert.equal((await send({ watchId: "w_btc_10_1h" })).status, 200);
    assert.equal((await send({ watchId: "w_btc_10_1h" })).status, 403);
  });
});
