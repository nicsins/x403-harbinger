import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET as streamGET } from "../app/api/v1/stream/route";
import { POST as hooksPOST } from "../app/api/v1/hooks/route";
import { POST as pumpPOST } from "../app/api/cron/notify-pump/route";
import { decideTrigger, measureCorrelation, type TriggerLeg, type TriggerQuote } from "../lib/trigger";
import { liveQuoteFromChart, QUOTE_MAX_AGE_MS } from "../lib/markets";
import { pearson } from "../lib/score";
import { setClockForTests } from "../lib/clock";
import { setInstrumentQuoteFetcherForTests, type InstrumentQuote } from "../lib/live-quote";
import { setDnsLookupForTests, verifySignature } from "../lib/hook-delivery";
import { sharedMemoryStore } from "../lib/grant-store";
import { MONITOR_FIRE_LUA, UpstashMonitorStore } from "../lib/monitor-store";
import { PAID_NOTIFY } from "../lib/paid-notify";
import * as protocol from "../lib/protocol";
import { REAL_TX, mockRpc, defaultReceipts, withEnv, resetSharedStore, synthTx, transferLog } from "./helpers";

const BASE = "https://www.x403-harbinger.com";
const T0 = Date.parse("2026-10-10T15:00:00Z");
const HOUR = 60 * 60 * 1000;

let now = T0;
const book: Record<string, { price: number; asOf: number; ok: boolean; stale: boolean }> = {};

function q(id: string, price: number, asOf: number, extra?: { ok?: boolean; stale?: boolean }) {
  book[id] = { price, asOf, ok: extra?.ok !== false, stale: Boolean(extra?.stale) };
}

function installQuotes() {
  setInstrumentQuoteFetcherForTests(async (ids) =>
    ids.map((id): InstrumentQuote => {
      const row = book[id] ?? { price: 100, asOf: now - 30_000, ok: true, stale: false };
      return {
        instrumentId: id,
        symbol: id,
        price: row.price,
        asOf: row.asOf,
        ok: row.ok,
        stale: row.stale,
        source: "yahoo-chart",
        interval: "1m",
        ...(row.ok ? {} : { error: "down" }),
      };
    }),
  );
}

const stream = (headers: Record<string, string>) =>
  streamGET(new Request(`${BASE}/v1/stream`, { headers: { accept: "application/json", ...headers } }));
const hooks = (headers: Record<string, string>, body: unknown) =>
  hooksPOST(
    new Request(`${BASE}/v1/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const G = (tx: string) => ({ "X-Harbinger-Grant": `hp1.${tx}` });
const W = (id: string) => ({ "X-Harbinger-Watch": id });

describe("quote as-of", () => {
  test("prefers regularMarketTime and marks a stale print", () => {
    const fresh = liveQuoteFromChart(
      "BTC-USD",
      { chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketTime: (T0 - 5_000) / 1000 }, timestamp: [(T0 - HOUR) / 1000], indicators: { quote: [{ close: [80] }] } }] } },
      T0,
    );
    assert.equal(fresh.ok, true);
    assert.equal(fresh.stale, false);
    assert.equal(fresh.price, 100);
    assert.equal(fresh.asOf, T0 - 5_000);
    const stale = liveQuoteFromChart(
      "BTC-USD",
      { chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketTime: (T0 - QUOTE_MAX_AGE_MS - 1) / 1000 } }] } },
      T0,
    );
    assert.equal(stale.ok, true);
    assert.equal(stale.stale, true);
  });
  test("falls back to the last 1m bar and rejects an empty chart", () => {
    const bar = liveQuoteFromChart(
      "ETH-USD",
      { chart: { result: [{ timestamp: [T0 / 1000], indicators: { quote: [{ close: [20] }] } }] } },
      T0 + 1_000,
    );
    assert.equal(bar.ok && bar.price, 20);
    assert.equal(bar.asOf, T0);
    const empty = liveQuoteFromChart("ETH-USD", { chart: { result: [{}] } }, T0);
    assert.equal(empty.ok, false);
  });
});

describe("trigger math", () => {
  const leg = (id: string, direction: TriggerLeg["direction"], thresholdPct: number): TriggerLeg => ({
    id,
    instrumentId: id,
    event: id,
    direction,
    thresholdPct,
  });
  const quote = (instrumentId: string, price: number, asOf: number, extra?: Partial<TriggerQuote>): TriggerQuote => ({
    instrumentId,
    price,
    asOf,
    ok: true,
    stale: false,
    ...extra,
  });
  const base = { btc: { price: 100, asOf: T0 - 1_000 }, eth: { price: 50, asOf: T0 - 1_000 } };

  function run(logic: "all" | "any", legs: TriggerLeg[], quotes: TriggerQuote[], at = T0 + 60_000, deadline = T0 + HOUR) {
    return decideTrigger({
      logic,
      legs,
      baseline: Object.fromEntries(legs.map((l) => [l.instrumentId, base[l.instrumentId as "btc" | "eth"] ?? { price: 100, asOf: T0 - 1_000 }])),
      samples: [],
      quotes,
      startedAt: T0,
      deadlineAt: deadline,
      now: at,
    });
  }

  test("direction, threshold, any and all", () => {
    const up = run("any", [leg("btc", "up", 5)], [quote("btc", 105, T0 + 1_000)]);
    assert.equal(up.action, "fire");
    const notUp = run("any", [leg("btc", "up", 5)], [quote("btc", 104, T0 + 1_000)]);
    assert.equal(notUp.action, "pending");
    const down = run("any", [leg("btc", "down", 5)], [quote("btc", 94, T0 + 1_000)]);
    assert.equal(down.action, "fire");
    const abs = run("any", [leg("btc", "abs", 10)], [quote("btc", 89, T0 + 1_000)]);
    assert.equal(abs.action, "fire");
    const onlyOne = [quote("btc", 120, T0 + 1_000), quote("eth", 50, T0 + 1_000)];
    assert.equal(run("any", [leg("btc", "abs", 10), leg("eth", "abs", 10)], onlyOne).action, "fire");
    assert.equal(run("all", [leg("btc", "abs", 10), leg("eth", "abs", 10)], onlyOne).action, "pending");
    const both = [quote("btc", 120, T0 + 1_000), quote("eth", 60, T0 + 2_000)];
    const joined = run("all", [leg("btc", "abs", 10), leg("eth", "abs", 10)], both);
    assert.equal(joined.action, "fire");
    if (joined.action === "fire") assert.equal(joined.firedAt, T0 + 2_000);
  });

  test("stale, provider error, pre-start and post-deadline quotes cannot fire", () => {
    const legs = [leg("btc", "abs", 10)];
    assert.equal(run("any", legs, [quote("btc", 200, T0 + 1_000, { stale: true })]).action, "pending");
    assert.equal(run("any", legs, [quote("btc", 200, T0 + 1_000, { ok: false })]).action, "pending");
    assert.equal(run("any", legs, [quote("btc", 200, T0)]).action, "pending");
    assert.equal(run("any", legs, [quote("btc", 200, T0 + HOUR + 1)], T0 + HOUR + 5_000).action, "no-move");
    const lateButInside = run("any", legs, [quote("btc", 200, T0 + HOUR - 1)], T0 + HOUR + 5_000);
    assert.equal(lateButInside.action, "fire");
    if (lateButInside.action === "fire") assert.equal(lateButInside.firedAt, T0 + HOUR - 1);
  });

  test("deadline without a move is no-move", () => {
    const d = run("any", [leg("btc", "abs", 10)], [quote("btc", 101, T0 + 1_000)], T0 + HOUR);
    assert.equal(d.action, "no-move");
  });

  test("one-leg correlation is null; multi-leg uses pearson and is not 0.99", () => {
    const one = measureCorrelation(["btc"], { btc: { price: 100 } }, Array.from({ length: 10 }, (_, i) => ({ at: i + 1, prices: { btc: 100 + i } })));
    assert.equal(one.correlation, null);
    assert.equal(one.note, "n/a");
    const samples = Array.from({ length: 8 }, (_, i) => ({
      at: i + 1,
      prices: { btc: 100 + i, eth: 50 + i * 0.4 },
    }));
    const multi = measureCorrelation(["btc", "eth"], { btc: { price: 100 }, eth: { price: 50 } }, samples);
    const xs: number[] = [];
    const ys: number[] = [];
    const points = [{ btc: 100, eth: 50 }, ...samples.map((s) => s.prices)];
    for (let i = 1; i < points.length; i++) {
      xs.push((points[i]!.btc - points[i - 1]!.btc) / points[i - 1]!.btc);
      ys.push((points[i]!.eth - points[i - 1]!.eth) / points[i - 1]!.eth);
    }
    assert.equal(multi.correlation, pearson(xs, ys));
    assert.notEqual(multi.correlation, 0.99);
    assert.equal(multi.note, "pearson");
    assert.ok((multi.samples ?? 0) >= 8);
  });
});

describe("paid stream and hooks", () => {
  let restoreEnv: () => void;
  let rpc: ReturnType<typeof mockRpc>;
  beforeEach(() => {
    now = T0;
    for (const k of Object.keys(book)) delete book[k];
    setClockForTests(() => now);
    installQuotes();
    setDnsLookupForTests(async () => ["93.184.216.34"]);
    restoreEnv = withEnv({ VERCEL_ENV: "production", GRANT_STORE: "memory", CRON_SECRET: "cron-test-secret" });
    resetSharedStore();
    rpc = mockRpc(defaultReceipts());
    PAID_NOTIFY.stream = true;
    PAID_NOTIFY.hooks = true;
    PAID_NOTIFY.agentmail = false;
  });
  afterEach(() => {
    rpc.restore();
    restoreEnv();
    resetSharedStore();
    setClockForTests(null);
    setInstrumentQuoteFetcherForTests(null);
    setDnsLookupForTests(null);
    PAID_NOTIFY.stream = true;
    PAID_NOTIFY.hooks = true;
    PAID_NOTIFY.agentmail = false;
  });

  test("settledPing is not exported", () => {
    assert.equal("settledPing" in protocol, false);
  });

  test("first stream request is pending and does not spend; a later cross fires once", async () => {
    q("btc", 100, T0 - 30_000);
    const opened = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(opened.status, 202);
    const pending = (await opened.json()) as { status: string; monitorId: string; grant: { used: number }; consumed: boolean };
    assert.equal(pending.status, "pending");
    assert.equal(pending.consumed, false);
    assert.equal(pending.grant.used, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    now = T0 + 120_000;
    q("btc", 150, T0 - 1);
    const ignored = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(ignored.status, 202);
    assert.equal(((await ignored.json()) as { grant: { used: number } }).grant.used, 0);

    const asOf = T0 + 90_000;
    q("btc", 112, asOf);
    const fired = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(fired.status, 200);
    const body = (await fired.json()) as {
      status: string;
      firedAt: string;
      correlation: number | null;
      correlationNote: string;
      receipt: string;
      grant: { used: number; quota: number };
      legs: { matched: boolean; pct: number }[];
      source: { asOf: string; interval: string };
    };
    assert.equal(body.status, "fired");
    assert.equal(body.firedAt, new Date(asOf).toISOString());
    assert.notEqual(body.firedAt, new Date(now).toISOString());
    assert.equal(body.correlation, null);
    assert.equal(body.correlationNote, "n/a");
    assert.equal(fired.headers.get("X-Harbinger-Correlation"), "n/a");
    assert.doesNotMatch(JSON.stringify(body), /0\.99/);
    assert.equal(body.grant.used, 1);
    assert.equal(body.grant.quota, 1);
    assert.equal(body.legs[0]?.matched, true);
    assert.equal(body.source.asOf, body.firedAt);
    assert.equal(body.source.interval, "1m");
    assert.match(body.receipt, /^rcpt\.w_btc_10_1h\.c3fd6b6f\./);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);

    const again = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h"), "X-Harbinger-Monitor": pending.monitorId });
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { receipt: string }).receipt, body.receipt);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);

    const exhausted = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(exhausted.status, 403);
    assert.equal(exhausted.headers.get("X-Harbinger-Forbidden"), "grant-exhausted");
  });

  test("concurrent polls consume one unit and return one ping", async () => {
    q("btc", 100, T0 - 30_000);
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 202);
    now = T0 + 60_000;
    q("btc", 130, T0 + 50_000);
    const [a, b] = await Promise.all([
      stream({ ...G(REAL_TX), ...W("w_btc_10_1h") }),
      stream({ ...G(REAL_TX), ...W("w_btc_10_1h") }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const ba = (await a.json()) as { receipt: string; firedAt: string; grant: { used: number } };
    const bb = (await b.json()) as { receipt: string; firedAt: string; grant: { used: number } };
    assert.equal(ba.receipt, bb.receipt);
    assert.equal(ba.firedAt, new Date(T0 + 50_000).toISOString());
    assert.equal(ba.grant.used, 1);
    assert.equal(bb.grant.used, 1);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("monitor-held poll survives bare grant TTL until the deadline (HP-2)", async () => {
    q("btc", 100, T0 - 30_000);
    const opened = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(opened.status, 202);
    const pending = (await opened.json()) as { monitorId: string; deadlineAt: string };
    const binding = await sharedMemoryStore().get(REAL_TX);
    assert.ok(binding);
    // Simulate early bind: bare TTL lapsed while the monitor window is still open.
    binding!.expiresAt = now - 1_000;
    const denied = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get("X-Harbinger-Forbidden"), "grant-expired");
    const held = await stream({
      ...G(REAL_TX),
      ...W("w_btc_10_1h"),
      "X-Harbinger-Monitor": pending.monitorId,
    });
    assert.equal(held.status, 202);
    const body = (await held.json()) as { status: string; monitorId: string; consumed: boolean };
    assert.equal(body.status, "pending");
    assert.equal(body.monitorId, pending.monitorId);
    assert.equal(body.consumed, false);
    assert.ok(((await sharedMemoryStore().get(REAL_TX))!.expiresAt) >= Date.parse(pending.deadlineAt));

    // Fire still works after the TTL heal.
    now = T0 + 90_000;
    q("btc", 120, T0 + 80_000);
    const fired = await stream({
      ...G(REAL_TX),
      ...W("w_btc_10_1h"),
      "X-Harbinger-Monitor": pending.monitorId,
    });
    assert.equal(fired.status, 200);
    assert.equal(((await fired.json()) as { status: string; consumed: boolean }).status, "fired");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("no move at the deadline does not consume and is idempotent", async () => {
    q("btc", 100, T0 - 30_000);
    const opened = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    const pending = (await opened.json()) as { monitorId: string };
    now = T0 + HOUR + 1_000;
    q("btc", 101, T0 + HOUR - 2_000);
    const done = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(done.status, 200);
    const body = (await done.json()) as { status: string; firedAt: null; consumed: boolean; monitorId: string; grant: { used: number }; note: string };
    assert.equal(body.status, "no-move");
    assert.equal(body.firedAt, null);
    assert.equal(body.consumed, false);
    assert.equal(body.grant.used, 0);
    assert.match(body.note, /not consumed/);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
    const again = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    const body2 = (await again.json()) as { status: string; monitorId: string; grant: { used: number } };
    assert.equal(body2.status, "no-move");
    assert.equal(body2.monitorId, pending.monitorId);
    assert.equal(body2.grant.used, 0);
    assert.doesNotMatch(JSON.stringify(body2), /0\.99/);
  });

  test("stale and provider-error samples do not fire, including at the deadline", async () => {
    q("btc", 100, T0 - QUOTE_MAX_AGE_MS - 5_000, { stale: true });
    const blocked = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(blocked.status, 503);
    assert.equal(((await blocked.json()) as { error: string }).error, "quote-stale");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    q("btc", 100, T0 - 10_000);
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 202);
    now = T0 + 30_000;
    q("btc", 180, T0 + 20_000, { stale: true });
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 202);
    q("btc", 180, T0 + 20_000, { ok: false });
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 202);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    now = T0 + HOUR + 1;
    q("btc", 180, now - 1_000, { stale: true });
    const done = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(((await done.json()) as { status: string }).status, "no-move");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
  });

  test("multi-leg correlation is measured over the window", async () => {
    q("eth", 100, T0 - 5_000);
    q("btc", 100, T0 - 5_000);
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") })).status, 202);
    for (let i = 1; i <= 7; i++) {
      now = T0 + i * 60_000;
      const px = 100 * (1 + 0.002 * i);
      q("eth", px, now);
      q("btc", px, now);
      const step = await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") });
      assert.equal(step.status, 202, `step ${i}`);
    }
    now = T0 + 8 * 60_000;
    q("eth", 106, now);
    q("btc", 106, now);
    const fired = await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    assert.equal(fired.status, 200);
    const body = (await fired.json()) as {
      correlation: number | null;
      correlationNote: string;
      correlationSamples: number;
      firedAt: string;
      grant: { used: number };
      legs: { matched: boolean }[];
    };
    assert.equal(body.correlationNote, "pearson");
    assert.equal(body.correlationSamples >= 8, true);
    assert.equal(typeof body.correlation, "number");
    assert.notEqual(body.correlation, 0.99);
    assert.ok(Math.abs((body.correlation as number) - 1) < 1e-9);
    assert.equal(body.firedAt, new Date(now).toISOString());
    assert.equal(body.legs.every((l) => l.matched), true);
    assert.equal(body.grant.used, 1);
    assert.equal(fired.headers.get("X-Harbinger-Correlation"), "1");
  });

  test("a mail watch is refused before the tx is bound", async () => {
    const mail = await stream({ ...G(REAL_TX), ...W("w_eth_funding") });
    assert.equal(mail.status, 400);
    assert.equal(((await mail.json()) as { error: string }).error, "watch-not-on-price-trigger");
    assert.equal(await sharedMemoryStore().get(REAL_TX), null);
    q("btc", 100, T0 - 1_000);
    assert.equal((await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).status, 202);
  });

  test("SSE pending event closes without a fake ping", async () => {
    q("btc", 100, T0 - 1_000);
    const res = await streamGET(
      new Request(`${BASE}/v1/stream`, {
        headers: { accept: "text/event-stream", ...G(REAL_TX), ...W("w_btc_10_1h") },
      }),
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^event: pending\n/);
    assert.doesNotMatch(text, /0\.99/);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
  });

  test("hook registration does not consume; pump fires once; retry does not double-charge; no-move does not deliver", async () => {
    const posts: { url: string; body: string; sig: string | null; id: string | null }[] = [];
    let hookStatus = 200;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
      const u = String(url);
      if (u.startsWith("https://hooks.example/")) {
        posts.push({
          url: u,
          body: String(init?.body ?? ""),
          sig: init?.headers?.["X-Harbinger-Signature"] ?? null,
          id: init?.headers?.["X-Harbinger-Delivery-Id"] ?? null,
        });
        return new Response("ok", { status: hookStatus });
      }
      return original(url as never, init as never);
    }) as typeof fetch;

    q("btc", 100, T0 - 5_000);
    const reg = await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: "https://hooks.example/notify" });
    assert.equal(reg.status, 202);
    const opened = (await reg.json()) as { grant: { used: number }; hookSecret: string; monitorId: string; status: string };
    assert.equal(opened.status, "pending");
    assert.equal(opened.grant.used, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    const pump = () =>
      pumpPOST(new Request(`${BASE}/api/cron/notify-pump`, { method: "POST", headers: { authorization: "Bearer cron-test-secret" } }));

    now = T0 + HOUR + 5_000;
    q("btc", 101, T0 + HOUR - 1_000);
    const quiet = await pump();
    assert.equal(quiet.status, 200);
    assert.equal(posts.length, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
    const quietBody = (await quiet.json()) as { noMove: number; delivered: number };
    assert.equal(quietBody.noMove, 1);
    assert.equal(quietBody.delivered, 0);
    const replay = await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: "https://hooks.example/notify" });
    assert.equal(((await replay.json()) as { status: string }).status, "no-move");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
    rpc.restore();
    globalThis.fetch = original;
  });

  test("scheduled fire consumes once and a failed delivery retry does not", async () => {
    const posts: { body: string; sig: string | null }[] = [];
    let hookStatus = 500;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
      const u = String(url);
      if (u.startsWith("https://hooks.example/")) {
        posts.push({ body: String(init?.body ?? ""), sig: init?.headers?.["X-Harbinger-Signature"] ?? null });
        return new Response("no", { status: hookStatus });
      }
      return original(url as never, init as never);
    }) as typeof fetch;
    const pump = () =>
      pumpPOST(new Request(`${BASE}/api/cron/notify-pump`, { method: "POST", headers: { authorization: "Bearer cron-test-secret" } }));

    q("btc", 100, T0 - 5_000);
    const reg = await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: "https://hooks.example/notify" });
    const secret = ((await reg.json()) as { hookSecret: string }).hookSecret;
    now = T0 + 60_000;
    q("btc", 120, T0 + 50_000);
    const first = await pump();
    assert.equal(first.status, 200);
    assert.equal(posts.length, 1);
    assert.equal(verifySignature(secret, posts[0]!.body, posts[0]!.sig ?? ""), true);
    const ping = JSON.parse(posts[0]!.body) as { status: string; firedAt: string; correlation: null };
    assert.equal(ping.status, "fired");
    assert.equal(ping.firedAt, new Date(T0 + 50_000).toISOString());
    assert.equal(ping.correlation, null);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);

    const held = await pump();
    assert.equal(held.status, 200);
    assert.equal(posts.length, 1);

    now += 31_000;
    hookStatus = 200;
    await pump();
    assert.equal(posts.length, 2);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
    await pump();
    assert.equal(posts.length, 2);
    rpc.restore();
    globalThis.fetch = original;
  });

  test("concurrent pumps deliver one fire and one consumption", async () => {
    let posts = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).startsWith("https://hooks.example/")) {
        posts += 1;
        return new Response("ok", { status: 200 });
      }
      return original(url as never, init as never);
    }) as typeof fetch;
    q("btc", 100, T0 - 5_000);
    assert.equal((await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: "https://hooks.example/notify" })).status, 202);
    now = T0 + 60_000;
    q("btc", 125, T0 + 40_000);
    const pump = () =>
      pumpPOST(new Request(`${BASE}/api/cron/notify-pump`, { method: "POST", headers: { authorization: "Bearer cron-test-secret" } }));
    await Promise.all([pump(), pump()]);
    assert.equal(posts, 1);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
    rpc.restore();
    globalThis.fetch = original;
  });

  test("private callbacks are rejected and a rebinding address is not fetched", async () => {
    for (const url of ["http://example.com/hook", "https://127.0.0.1/hook", "https://169.254.169.254/", "https://10.1.1.1/hook"]) {
      resetSharedStore();
      const r = await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: url });
      assert.equal(r.status, 400, url);
      assert.equal(((await r.json()) as { error: string }).error, "callback-invalid");
      assert.equal((await sharedMemoryStore().get(REAL_TX))?.used ?? 0, 0);
    }
    resetSharedStore();
    q("btc", 100, T0 - 5_000);
    assert.equal((await hooks({ ...G(REAL_TX), ...W("w_btc_10_1h") }, { callbackUrl: "https://hooks.example/notify" })).status, 202);
    setDnsLookupForTests(async () => ["127.0.0.1"]);
    let posts = 0;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).startsWith("https://hooks.example/")) {
        posts += 1;
        return new Response("ok", { status: 200 });
      }
      return original(url as never, init as never);
    }) as typeof fetch;
    now = T0 + 60_000;
    q("btc", 130, T0 + 30_000);
    const pump = await pumpPOST(
      new Request(`${BASE}/api/cron/notify-pump`, { method: "POST", headers: { authorization: "Bearer cron-test-secret" } }),
    );
    assert.equal(pump.status, 200);
    assert.equal(posts, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
    rpc.restore();
    globalThis.fetch = original;
  });

  test("pump is fail-closed without CRON_SECRET and rejects a bad bearer", async () => {
    restoreEnv();
    restoreEnv = withEnv({ VERCEL_ENV: "production", GRANT_STORE: "memory" });
    const missing = await pumpPOST(new Request(`${BASE}/api/cron/notify-pump`, { method: "POST" }));
    assert.equal(missing.status, 503);
    assert.match(await missing.text(), /cron-secret-missing/);
    restoreEnv();
    restoreEnv = withEnv({ VERCEL_ENV: "production", GRANT_STORE: "memory", CRON_SECRET: "cron-test-secret" });
    const bad = await pumpPOST(new Request(`${BASE}/api/cron/notify-pump`, { method: "POST", headers: { authorization: "Bearer no" } }));
    assert.equal(bad.status, 401);
  });

  test("upstash fire is one EVAL that consumes the grant key and the monitor together", async () => {
    rpc.restore();
    const seen: unknown[][] = [];
    const monitor = {
      id: "mon_test",
      kind: "stream",
      watchId: "w_btc_10_1h",
      grantKey: REAL_TX,
      startedAt: T0,
      deadlineAt: T0 + HOUR,
      baseline: { btc: { price: 100, asOf: T0 - 1 } },
      samples: [],
      status: "pending",
      firedAt: null,
      consumed: false,
      result: null,
    };
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "[]")) as unknown[];
      seen.push(body);
      if (body[0] === "GET") return Response.json({ result: JSON.stringify(monitor) });
      const fired = { ...monitor, status: "fired", consumed: true, firedAt: T0 + 1, grantUsed: 1 };
      return Response.json({ result: JSON.stringify({ ok: true, idempotent: false, monitor: fired }) });
    }) as typeof fetch;
    const store = new UpstashMonitorStore("https://example.upstash.io", "token");
    const fin = await store.fire("mon_test", T0 + 1, T0 + 1, { status: "fired" }, { at: T0 + 1, prices: { btc: 120 } });
    assert.equal(fin.ok, true);
    const evals = seen.filter((c) => c[0] === "EVAL");
    assert.equal(evals.length, 1);
    assert.equal(evals[0]?.[1], MONITOR_FIRE_LUA);
    assert.match(MONITOR_FIRE_LUA, /b\.used = tonumber\(b\.used\) \+ 1/);
    assert.match(String(evals[0]), /harbinger:grant:/);
    assert.match(String(evals[0]), /harbinger:mon:mon_test/);
  });

  test("a second synth tx still binds after a no-move on the first", async () => {
    const tx = synthTx(77);
    rpc.restore();
    rpc = mockRpc({ [tx]: { status: "0x1", blockNumber: "0x1", logs: [transferLog(220000)] }, ...defaultReceipts() });
    q("btc", 100, T0 - 1_000);
    assert.equal((await stream({ ...G(tx), ...W("w_btc_10_1h") })).status, 202);
    now = T0 + HOUR + 10;
    q("btc", 100, T0 + 1_000);
    const done = await stream({ ...G(tx), ...W("w_btc_10_1h") });
    assert.equal(((await done.json()) as { status: string; grant: { used: number } }).status, "no-move");
    assert.equal((await sharedMemoryStore().get(tx))?.used, 0);
  });
});
