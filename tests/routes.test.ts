import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as streamGET } from "../app/api/v1/stream/route";
import { POST as hooksPOST } from "../app/api/v1/hooks/route";
import { POST as patrolPOST } from "../app/api/v1/patrol/route";
import { POST as mailPOST } from "../app/api/v1/agentmail/route";
import { checkGrant } from "../lib/grant";
import { sharedMemoryStore } from "../lib/grant-store";
import { setClockForTests } from "../lib/clock";
import { setInstrumentQuoteFetcherForTests } from "../lib/live-quote";
import { PAID_NOTIFY } from "../lib/paid-notify";
import { REAL_TX, MARKET_TX, FAKE_TX, mockRpc, defaultReceipts, withEnv, resetSharedStore } from "./helpers";

const BASE = "https://www.x403-harbinger.com";
const stream = (headers: Record<string, string>, qs = "") =>
  streamGET(new Request(`${BASE}/v1/stream${qs}`, { headers: { accept: "application/json", ...headers } }));
const hooks = (headers: Record<string, string>, body: unknown = {}) =>
  hooksPOST(new Request(`${BASE}/v1/hooks`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const G = (tx: string) => ({ "X-Harbinger-Grant": `hp1.${tx}` });
const W = (id: string) => ({ "X-Harbinger-Watch": id });
const HOOK_URL = "https://example.com/harbinger-hook";

let rpc: ReturnType<typeof mockRpc>;
let restoreEnv: () => void;
beforeEach(() => {
  // Production semantics, with the in-memory store explicitly opted in for tests.
  restoreEnv = withEnv({ VERCEL_ENV: "production", GRANT_STORE: "memory" });
  resetSharedStore();
  rpc = mockRpc(defaultReceipts());
  // Stream and hooks use the real-move path. AgentMail send stays paused.
  PAID_NOTIFY.stream = true;
  PAID_NOTIFY.hooks = true;
  PAID_NOTIFY.agentmail = false;
  setClockForTests(null);
  setInstrumentQuoteFetcherForTests(async (ids, now) =>
    ids.map((id) => ({
      instrumentId: id,
      symbol: id,
      price: 100,
      asOf: now - 60_000,
      ok: true,
      stale: false,
      source: "yahoo-chart" as const,
      interval: "1m" as const,
    })),
  );
});
afterEach(() => {
  PAID_NOTIFY.stream = true;
  PAID_NOTIFY.hooks = true;
  PAID_NOTIFY.agentmail = false;
  setInstrumentQuoteFetcherForTests(null);
  setClockForTests(null);
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
  test("real grant on w_btc_10_1h is pending and does not spend; other watch is refused", async () => {
    const ok = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(ok.status, 202);
    const body = (await ok.json()) as {
      status: string;
      watchId: string;
      consumed: boolean;
      monitorId: string;
      correlation?: number;
      grant: { used: number; quota: number };
    };
    assert.equal(body.status, "pending");
    assert.equal(body.watchId, "w_btc_10_1h");
    assert.equal(body.consumed, false);
    assert.equal(body.correlation, undefined);
    assert.doesNotMatch(JSON.stringify(body), /0\.99/);
    assert.deepEqual([body.grant.used, body.grant.quota], [0, 1]);

    const again = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(again.status, 202);
    const body2 = (await again.json()) as { monitorId: string; grant: { used: number } };
    assert.equal(body2.monitorId, body.monitorId);
    assert.equal(body2.grant.used, 0);

    const other = await stream({ ...G(REAL_TX), ...W("w_btc_5_1h") });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get("X-Harbinger-Forbidden"), "grant-bound-to-other-watch");
  });
  test("?watch= query still names the watch", async () => {
    const r = await stream(G(REAL_TX), "?watch=w_btc_10_1h");
    assert.equal(r.status, 202);
    assert.equal(((await r.json()) as { watchId: string }).watchId, "w_btc_10_1h");
  });
  test("marketplace 0.004 settle -> 403 insufficient-payment on a price watch", async () => {
    const r = await stream({ ...G(MARKET_TX), ...W("w_oil_usd") });
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
  test("dev/preview: demo + price watch is pending; demo without watch -> 400; mail watch is not price-gated", async () => {
    restoreEnv();
    restoreEnv = withEnv({});
    const ok = await stream({ "X-Harbinger-Grant": "hp1.demo", ...W("w_btc_10_1h") });
    assert.equal(ok.status, 202);
    const body = (await ok.json()) as { status: string; correlation?: number };
    assert.equal(body.status, "pending");
    assert.equal(body.correlation, undefined);
    assert.doesNotMatch(JSON.stringify(body), /0\.99/);
    assert.equal((await stream({ "X-Harbinger-Grant": "hp1.demo" })).status, 400);
    const mail = await stream({ "X-Harbinger-Grant": "hp1.demo", ...W("w_eth_funding") });
    assert.equal(mail.status, 400);
    assert.equal(((await mail.json()) as { error: string }).error, "watch-not-on-price-trigger");
  });
});

describe("POST /v1/hooks", () => {
  test("unpaid + watch header (marketplace try/notify shape) -> 403 grant-required", async () => {
    const r = await hooks(W("w_btc_10_1h"));
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
  test("fresh hook registration does not consume; a second registration stays pending", async () => {
    const a = await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: HOOK_URL });
    assert.equal(a.status, 202);
    const body = (await a.json()) as { protocol: string; accepted: boolean; watchId: string; status: string; grant: { used: number }; hookSecret: string };
    assert.equal(body.protocol, "x403-HARBINGER/1.0");
    assert.equal(body.accepted, true);
    assert.equal(body.watchId, "w_btc_10_1h");
    assert.equal(body.status, "pending");
    assert.equal(body.grant.used, 0);
    assert.equal(typeof body.hookSecret, "string");
    const again = await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: HOOK_URL });
    assert.equal(again.status, 202);
    assert.equal(((await again.json()) as { grant: { used: number } }).grant.used, 0);
    const otherRail = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(otherRail.status, 409);
    assert.equal(((await otherRail.json()) as { error: string }).error, "monitor-pending-other-kind");
  });
  test("hook registration rejects a grant bound to another watch", async () => {
    assert.equal((await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: HOOK_URL })).status, 202);
    const other = await hooks({ ...G(REAL_TX), ...W("w_btc_5_1h") });
    assert.equal(other.status, 403);
    assert.equal(other.headers.get("X-Harbinger-Forbidden"), "grant-bound-to-other-watch");
  });
  test("price check uses the requested watch", async () => {
    const r = await hooks(G(MARKET_TX), { watchId: "w_oil_usd", callbackUrl: HOOK_URL });
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { forbidden: "insufficient-payment" });
  });
});

describe("patrol + agentmail send share the gate", () => {
  test("patrol unpaid 403; demo 403 on prod; tx grant bound by the stream watch is refused for patrol once that ping is spent", async () => {
    const p = (h: Record<string, string>) => patrolPOST(new Request(`${BASE}/v1/patrol`, { method: "POST", headers: h }));
    assert.equal((await p({})).status, 403);
    assert.equal((await p({ "X-Harbinger-Grant": "hp1.demo" })).status, 403);
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 202);
    const spent = await checkGrant(`hp1.${REAL_TX}`, "w_btc_10_1h", { id: "w_btc_10_1h", priceUsdc: 0.22, billing: "per-ping" }, { consume: true, store: sharedMemoryStore() });
    assert.equal(spent.ok, true);
    assert.equal((await p(G(REAL_TX))).status, 403); // default watch w_btc_10_1h, quota spent
    assert.equal((await p({ ...G(REAL_TX), ...W("w_btc_5_1h") })).status, 403); // bound elsewhere
  });
  test("agentmail send stays paused; flipping the flag still exercises the grant gate", async () => {
    const send = (body: Record<string, unknown>) =>
      mailPOST(new Request(`${BASE}/v1/rails/agentmail`, { method: "POST", headers: { ...G(REAL_TX), "content-type": "application/json" }, body: JSON.stringify({ action: "send", ...body }) }));
    assert.equal((await send({ watchId: "w_btc_10_1h" })).status, 503);
    assert.equal(rpc.calls.length, 0);
    PAID_NOTIFY.agentmail = true;
    assert.equal((await send({})).status, 400);
    assert.equal((await send({ watchId: "w_btc_10_1h" })).status, 200);
    assert.equal((await send({ watchId: "w_btc_10_1h" })).status, 403);
  });
});

describe("hotfix: paid notify paused per endpoint", () => {
  beforeEach(() => {
    PAID_NOTIFY.stream = false;
    PAID_NOTIFY.hooks = false;
    PAID_NOTIFY.agentmail = false;
  });
  test("stream, hooks and agentmail send -> 503 paid-notify-paused, no challenge, no payTo", async () => {
    const send = mailPOST(new Request(`${BASE}/v1/rails/agentmail`, { method: "POST", headers: { ...G(REAL_TX), "content-type": "application/json" }, body: JSON.stringify({ action: "send", watchId: "w_btc_10_1h" }) }));
    for (const r of [await stream(W("w_btc_10_1h")), await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") }), await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }), await send]) {
      assert.equal(r.status, 503);
      assert.equal(r.headers.get("X-Harbinger-Forbidden"), null);
      assert.equal(r.headers.get("X-Harbinger-Price"), null);
      const text = await r.text();
      assert.match(text, /paid-notify-paused/);
      assert.doesNotMatch(text, /payTo|0\.99|receipt/);
    }
  });
  test("paused endpoints never redeem or consume a grant", async () => {
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 503);
    assert.equal((await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: HOOK_URL })).status, 503);
    const send = () =>
      mailPOST(new Request(`${BASE}/v1/rails/agentmail`, { method: "POST", headers: { ...G(REAL_TX), "content-type": "application/json" }, body: JSON.stringify({ action: "send", watchId: "w_btc_10_1h" }) }));
    assert.equal((await send()).status, 503);
    assert.equal(rpc.calls.length, 0);
    PAID_NOTIFY.stream = true;
    const opened = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(opened.status, 202);
    const body = (await opened.json()) as { status: string; grant: { used: number }; consumed: boolean };
    assert.equal(body.status, "pending");
    assert.equal(body.consumed, false);
    assert.equal(body.grant.used, 0);
    assert.doesNotMatch(JSON.stringify(body), /0\.99/);
    PAID_NOTIFY.stream = false;
    assert.equal((await send()).status, 503);
  });
});
