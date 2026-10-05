import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { GET as streamGET } from "../app/api/v1/stream/route";
import { POST as hooksPOST } from "../app/api/v1/hooks/route";
import { GET as pumpGET } from "../app/api/v1/pump/route";
import { publicCard } from "../lib/catalog";
import { WATCHES } from "../lib/protocol";
import { sharedMemoryStore } from "../lib/grant-store";
import { quoteFromYahoo, QUOTE_MAX_AGE_MS, type Quote } from "../lib/markets";
import { advanceMonitor, setDeliverForTests, setNowForTests, setQuotesForTests } from "../lib/monitor";
import { fromLua, sharedMemoryMonitor, UpstashMonitorStore, type Monitor } from "../lib/monitor-store";
import { guardedLookup, validateCallbackUrl } from "../lib/hook";
import { measureCorrelation, stepTrigger, type EvalLeg, type TriggerState } from "../lib/trigger";
import { findWatch } from "../lib/protocol";
import { REAL_TX, mockRpc, defaultReceipts, withEnv, resetSharedStore, synthTx, transferLog } from "./helpers";

const BASE = "https://www.x403-harbinger.com";
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SECRET = "hook-test-secret";
const CRON = "cron-test-secret";

const G = (tx: string) => ({ "X-Harbinger-Grant": `hp1.${tx}` });
const W = (id: string) => ({ "X-Harbinger-Watch": id });

const stream = (headers: Record<string, string>, qs = "") =>
  streamGET(new Request(`${BASE}/v1/stream${qs}`, { headers: { accept: "application/json", ...headers } }));
const hooks = (headers: Record<string, string>, body: unknown) =>
  hooksPOST(
    new Request(`${BASE}/v1/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const pump = () =>
  pumpGET(new Request(`${BASE}/api/v1/pump`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));

type Fired = {
  status: string;
  watchId: string;
  firedAt: string | null;
  correlation: number | null;
  correlationNote: string;
  receipt: string;
  asOf: string;
  monitorId: string;
  logic: string;
  samples: number;
  legs: { instrumentId: string; matched: boolean; pct: number; baseline: number; price: number; direction: string }[];
  grant?: { used: number; quota: number; kind?: string };
};

let rpc: ReturnType<typeof mockRpc>;
let restoreEnv: () => void;
let posts: { url: string; body: string; signature: string }[];

function q(symbol: string, price: number | null, asOf: number, extra: Partial<Quote> = {}): Quote {
  return {
    symbol,
    price,
    asOf,
    ok: extra.ok ?? price != null,
    stale: extra.stale ?? false,
    source: "yahoo-chart",
    interval: "1m",
    ...extra,
  };
}

function useQuotes(fn: (symbols: string[], now: number) => Quote[]) {
  setQuotesForTests(async (symbols, now) => fn(symbols, now));
}

beforeEach(() => {
  restoreEnv = withEnv({
    VERCEL_ENV: "production",
    GRANT_STORE: "memory",
    CRON_SECRET: CRON,
    HOOK_SIGNING_SECRET: SECRET,
  });
  resetSharedStore();
  rpc = mockRpc(defaultReceipts());
  posts = [];
  setNowForTests(T0);
  setDeliverForTests(async (job) => {
    posts.push(job);
    return { ok: true, status: 200 };
  });
  useQuotes(() => []);
});
afterEach(() => {
  rpc.restore();
  restoreEnv();
  resetSharedStore();
});

const leg = (instrumentId: string, direction: EvalLeg["direction"], thresholdPct: number): EvalLeg => ({
  instrumentId,
  symbol: instrumentId,
  label: instrumentId,
  event: `${instrumentId}.${direction}.${thresholdPct}`,
  direction,
  thresholdPct,
  windowMinutes: 60,
});

function state(over: Partial<TriggerState> = {}): TriggerState {
  return {
    startedAt: 1_000,
    deadlineAt: 1_000 + HOUR,
    baseline: null,
    samples: [],
    ...over,
  };
}

describe("pure trigger", () => {
  test("directions, thresholds, all/any, and the deadline", () => {
    const legs = [leg("btc", "up", 5), leg("eth", "down", 5)];
    const baseline = { asOf: 1_000, prices: { btc: 100, eth: 100 } };
    const up = stepTrigger(
      state({ baseline, startedAt: 1_000 }),
      "any",
      legs,
      new Map([
        ["btc", q("btc", 105, 2_000)],
        ["eth", q("eth", 100, 2_000)],
      ]),
      2_000,
    );
    assert.equal(up.action, "fire");
    if (up.action === "fire") {
      assert.equal(up.firedAt, 2_000);
      assert.equal(up.measurements.find((m) => m.instrumentId === "btc")?.matched, true);
      assert.equal(up.measurements.find((m) => m.instrumentId === "eth")?.matched, false);
    }

    const allMiss = stepTrigger(
      state({ baseline, startedAt: 1_000 }),
      "all",
      legs,
      new Map([
        ["btc", q("btc", 105, 2_000)],
        ["eth", q("eth", 100, 2_000)],
      ]),
      2_000,
    );
    assert.equal(allMiss.action, "save");

    const allHit = stepTrigger(
      state({ baseline, startedAt: 1_000 }),
      "all",
      [leg("btc", "up", 5), leg("eth", "up", 5)],
      new Map([
        ["btc", q("btc", 105, 2_000)],
        ["eth", q("eth", 105, 2_000)],
      ]),
      2_000,
    );
    assert.equal(allHit.action, "fire");

    const down = stepTrigger(
      state({ baseline: { asOf: 1_000, prices: { btc: 100 } }, startedAt: 1_000 }),
      "any",
      [leg("btc", "down", 5)],
      new Map([["btc", q("btc", 95, 2_000)]]),
      2_000,
    );
    assert.equal(down.action, "fire");
    const notDown = stepTrigger(
      state({ baseline: { asOf: 1_000, prices: { btc: 100 } }, startedAt: 1_000 }),
      "any",
      [leg("btc", "down", 5)],
      new Map([["btc", q("btc", 110, 2_000)]]),
      2_000,
    );
    assert.equal(notDown.action, "save");

    const exact = stepTrigger(
      state({ baseline: { asOf: 1_000, prices: { btc: 200 } }, startedAt: 1_000 }),
      "any",
      [leg("btc", "abs", 10)],
      new Map([["btc", q("btc", 220, 2_000)]]),
      2_000,
    );
    assert.equal(exact.action, "fire");

    const open = stepTrigger(
      state({ baseline, startedAt: 1_000, deadlineAt: 5_000 }),
      "any",
      [leg("btc", "up", 50), leg("eth", "up", 50)],
      new Map([
        ["btc", q("btc", 101, 2_000)],
        ["eth", q("eth", 101, 2_000)],
      ]),
      2_000,
    );
    assert.equal(open.action, "save");
    const closed = stepTrigger(
      state({ baseline, startedAt: 1_000, deadlineAt: 5_000 }),
      "any",
      [leg("btc", "up", 50), leg("eth", "up", 50)],
      new Map([
        ["btc", q("btc", 101, 4_000)],
        ["eth", q("eth", 101, 4_000)],
      ]),
      5_000,
    );
    assert.equal(closed.action, "no-move");
    if (closed.action === "no-move") assert.equal(closed.correlation === 0.99, false);
  });

  test("a quote at or before start never fires, and the first quote is only a baseline", () => {
    const legs = [leg("btc", "abs", 10)];
    const first = stepTrigger(state(), "any", legs, new Map([["btc", q("btc", 500, 1_000)]]), 1_000);
    assert.equal(first.action, "save");
    const atStart = stepTrigger(
      state({ baseline: { asOf: 900, prices: { btc: 100 } } }),
      "any",
      legs,
      new Map([["btc", q("btc", 150, 1_000)]]),
      1_000,
    );
    assert.equal(atStart.action, "keep");
    const after = stepTrigger(
      state({ baseline: { asOf: 1_000, prices: { btc: 100 } } }),
      "any",
      legs,
      new Map([["btc", q("btc", 111, 1_001)]]),
      1_001,
    );
    assert.equal(after.action, "fire");
    if (after.action === "fire") assert.equal(after.firedAt, 1_001);
  });

  test("stale and provider-error quotes cannot fire", () => {
    const legs = [leg("btc", "abs", 1)];
    const baseline = { asOf: 1_000, prices: { btc: 100 } };
    const stale = stepTrigger(
      state({ baseline }),
      "any",
      legs,
      new Map([["btc", q("btc", 500, 2_000, { stale: true })]]),
      2_000,
    );
    assert.equal(stale.action, "keep");
    const broken = stepTrigger(
      state({ baseline }),
      "any",
      legs,
      new Map([["btc", q("btc", 500, 2_000, { ok: false, stale: true, price: null })]]),
      2_000,
    );
    assert.equal(broken.action, "keep");
    const old = stepTrigger(
      state({ baseline, startedAt: 10_000 }),
      "any",
      legs,
      new Map([["btc", q("btc", 500, 10_000 - QUOTE_MAX_AGE_MS - 1)]]),
      10_000,
    );
    assert.equal(old.action, "keep");
    const deadline = stepTrigger(
      state({ baseline, deadlineAt: 2_000 }),
      "any",
      legs,
      new Map([["btc", q("btc", null, 2_000, { ok: false, stale: true })]]),
      2_000,
    );
    assert.equal(deadline.action, "no-move");
  });

  test("correlation is measured for two legs and null for one", () => {
    const one = measureCorrelation([leg("btc", "abs", 1)], [
      { asOf: 1, prices: { btc: 1 } },
      { asOf: 2, prices: { btc: 2 } },
    ]);
    assert.deepEqual(one, { correlation: null, note: "one-leg" });

    const points = [];
    let a = 100;
    let b = 50;
    points.push({ asOf: 0, prices: { btc: a, eth: b } });
    for (let i = 0; i < 8; i++) {
      a *= 1.004;
      b *= 1.004;
      points.push({ asOf: i + 1, prices: { btc: a, eth: b } });
    }
    a *= 1.08;
    b *= 1.08;
    points.push({ asOf: 9, prices: { btc: a, eth: b } });
    const many = measureCorrelation([leg("btc", "abs", 1), leg("eth", "abs", 1)], points);
    assert.equal(many.note, "measured");
    assert.ok(many.correlation != null && Math.abs(many.correlation - 1) < 1e-9);
    assert.notEqual(many.correlation, 0.99);

    const short = measureCorrelation(
      [leg("btc", "abs", 1), leg("eth", "abs", 1)],
      [
        { asOf: 1, prices: { btc: 100, eth: 100 } },
        { asOf: 2, prices: { btc: 101, eth: 102 } },
      ],
    );
    assert.equal(short.correlation, null);
    assert.equal(short.note, "insufficient-samples");
  });
});

describe("quote adapter", () => {
  test("fresh market time is usable; an old print is stale and not a fire", () => {
    const now = T0 + 10 * 60_000;
    const fresh = quoteFromYahoo(
      "BTC-USD",
      {
        chart: {
          result: [
            {
              meta: { regularMarketPrice: 111, regularMarketTime: Math.floor((now - 30_000) / 1000) },
              timestamp: [Math.floor((now - 60_000) / 1000)],
              indicators: { quote: [{ close: [100] }] },
            },
          ],
        },
      },
      now,
    );
    assert.equal(fresh.ok, true);
    assert.equal(fresh.stale, false);
    assert.equal(fresh.price, 111);
    assert.equal(fresh.asOf, (Math.floor((now - 30_000) / 1000)) * 1000);
    assert.equal(fresh.interval, "1m");

    const stale = quoteFromYahoo(
      "BTC-USD",
      {
        chart: {
          result: [
            {
              meta: { regularMarketPrice: 150, regularMarketTime: Math.floor((now - 10 * 60_000) / 1000) },
              timestamp: [Math.floor((now - 10 * 60_000) / 1000)],
              indicators: { quote: [{ close: [150] }] },
            },
          ],
        },
      },
      now,
    );
    assert.equal(stale.stale, true);
    assert.ok(now - (stale.asOf ?? now) > QUOTE_MAX_AGE_MS);
  });
});

describe("stream monitor", () => {
  test("first poll is pending and does not spend quota", async () => {
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, 100, now)));
    const res = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; firedAt: null; grant: { used: number; quota: number }; baselineReady: boolean };
    assert.equal(body.status, "pending");
    assert.equal(body.firedAt, null);
    assert.equal(body.baselineReady, true);
    assert.deepEqual([body.grant.used, body.grant.quota], [0, 1]);
    assert.equal(res.headers.get("X-Harbinger-Correlation"), "n/a");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
  });

  test("a post-start cross returns one ping, the sample time, and one spend", async () => {
    useQuotes((symbols, now) => {
      const price = now === T0 ? 100 : 120;
      const asOf = now === T0 ? T0 : now - 15_000;
      return symbols.map((symbol) => q(symbol, price, asOf));
    });
    const armed = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(((await armed.json()) as { status: string }).status, "pending");

    setNowForTests(T0 + 60_000);
    const fired = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(fired.status, 200);
    const body = (await fired.json()) as Fired;
    assert.equal(body.status, "fired");
    assert.equal(body.firedAt, new Date(T0 + 60_000 - 15_000).toISOString());
    assert.notEqual(body.firedAt, new Date(T0 + 60_000).toISOString());
    assert.equal(body.asOf, body.firedAt);
    assert.equal(body.correlation, null);
    assert.equal(body.correlationNote, "one-leg");
    assert.equal(body.logic, "any");
    assert.equal(fired.headers.get("X-Harbinger-Correlation"), "n/a");
    assert.equal(JSON.stringify(body).includes("0.99"), false);
    assert.equal(body.legs[0]?.matched, true);
    assert.equal(body.legs[0]?.baseline, 100);
    assert.equal(body.legs[0]?.price, 120);
    assert.equal(body.legs[0]?.pct, 20);
    assert.equal(body.grant?.used, 1);
    assert.match(body.receipt, /^rcpt\.w_btc_10_1h\.c3fd6b6f\./);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);

    const replay = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(replay.status, 403);
    assert.equal(replay.headers.get("X-Harbinger-Forbidden"), "grant-exhausted");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("multi-leg all join measures correlation and does not fire on one leg", async () => {
    const step = 60_000;
    const prices = (start: number) => {
      const out = [start];
      let p = start;
      for (let i = 0; i < 8; i++) {
        p *= 1.004;
        out.push(p);
      }
      out.push(p * 1.08);
      return out;
    };
    const btc = prices(100);
    const eth = prices(50);
    const flat = prices(50).map(() => 50);
    useQuotes((symbols, now) => {
      const i = Math.round((now - T0) / step);
      return symbols.map((symbol) => {
        const series = symbol === "BTC-USD" ? btc : eth;
        return q(symbol, series[Math.min(i, series.length - 1)] ?? series[0]!, now === T0 ? T0 : now - 15_000);
      });
    });

    setNowForTests(T0);
    assert.equal(((await (await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") })).json()) as { status: string }).status, "pending");
    for (let i = 1; i <= 8; i++) {
      setNowForTests(T0 + i * step);
      const mid = (await (await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") })).json()) as { status: string; grant: { used: number } };
      assert.equal(mid.status, "pending");
      assert.equal(mid.grant.used, 0);
    }
    setNowForTests(T0 + 9 * step);
    const fired = await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    const body = (await fired.json()) as Fired;
    assert.equal(body.status, "fired");
    assert.equal(body.logic, "all");
    assert.equal(body.correlationNote, "measured");
    assert.ok(body.correlation != null && Math.abs(body.correlation - 1) < 1e-9);
    assert.notEqual(body.correlation, 0.99);
    assert.equal(fired.headers.get("X-Harbinger-Correlation"), "1.00");
    assert.equal(body.firedAt, new Date(T0 + 9 * step - 15_000).toISOString());
    assert.equal(body.legs.every((l) => l.matched), true);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);

    resetSharedStore();
    rpc.restore();
    rpc = mockRpc(defaultReceipts());
    setNowForTests(T0);
    useQuotes((symbols, now) => {
      const i = Math.max(0, Math.round((now - T0) / step));
      return symbols.map((symbol) => {
        const series = symbol === "BTC-USD" ? btc : flat;
        return q(symbol, series[Math.min(i, series.length - 1)] ?? 50, now === T0 ? T0 : now - 15_000);
      });
    });
    await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") });
    setNowForTests(T0 + 9 * step);
    const missed = (await (await stream({ ...G(REAL_TX), ...W("w_eth_btc_join") })).json()) as { status: string; grant: { used: number } };
    assert.equal(missed.status, "pending");
    assert.equal(missed.grant.used, 0);
  });

  test("no-move is idempotent, spends nothing, and rearm opens a new window", async () => {
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, 100, now - 15_000)));
    const armed = (await (await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).json()) as { monitorId: string; grant: { used: number } };
    assert.equal(armed.grant.used, 0);
    setNowForTests(T0 + HOUR);
    const done = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    const body = (await done.json()) as { status: string; firedAt: null; monitorId: string; credit: string; grant: { used: number } };
    assert.equal(body.status, "no-move");
    assert.equal(body.firedAt, null);
    assert.equal(body.credit, "no-consume-no-refund");
    assert.equal(body.grant.used, 0);
    assert.equal(body.monitorId, armed.monitorId);
    const again = (await (await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).json()) as { status: string; monitorId: string };
    assert.equal(again.status, "no-move");
    assert.equal(again.monitorId, armed.monitorId);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    const re = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h"), "X-Harbinger-Rearm": "1" });
    const next = (await re.json()) as { status: string; monitorId: string; grant: { used: number } };
    assert.equal(next.status, "pending");
    assert.notEqual(next.monitorId, armed.monitorId);
    assert.equal(next.grant.used, 0);
  });

  test("concurrent polls fire once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hits = 0;
    setQuotesForTests(async (symbols, now) => {
      const price = now === T0 ? 100 : 130;
      const asOf = now === T0 ? T0 : now - 15_000;
      if (now !== T0) {
        hits += 1;
        if (hits >= 2) release();
        await gate;
      }
      return symbols.map((symbol) => q(symbol, price, asOf));
    });
    await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    setNowForTests(T0 + 60_000);
    const pair = await Promise.race([
      Promise.all([stream({ ...G(REAL_TX), ...W("w_btc_10_1h") }), stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("concurrent polls hung")), 2000)),
    ]);
    const bodies: Fired[] = [];
    for (const res of pair) {
      assert.equal(res.status, 200);
      const body = (await res.json()) as Fired;
      assert.equal(body.status, "fired");
      bodies.push(body);
    }
    assert.equal(bodies[0]?.receipt, bodies[1]?.receipt);
    assert.equal(bodies[0]?.firedAt, new Date(T0 + 60_000 - 15_000).toISOString());
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("expired grant is refused and a direct double advance spends once", async () => {
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, now === T0 ? 100 : 140, now === T0 ? now : now - 15_000)));
    await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    setNowForTests(T0 + DAY);
    const late = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(late.status, 403);
    assert.equal(late.headers.get("X-Harbinger-Forbidden"), "grant-expired");
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    resetSharedStore();
    rpc.restore();
    rpc = mockRpc(defaultReceipts());
    setNowForTests(T0);
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, now === T0 ? 100 : 140, now === T0 ? now : now - 15_000)));
    await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    const found = await sharedMemoryMonitor().find(REAL_TX, "w_btc_10_1h");
    const watch = findWatch("w_btc_10_1h");
    assert.ok(found && watch);
    setNowForTests(T0 + 60_000);
    const [a, b] = await Promise.all([
      advanceMonitor(found!, watch!, T0 + 60_000, sharedMemoryMonitor()),
      advanceMonitor(found!, watch!, T0 + 60_000, sharedMemoryMonitor()),
    ]);
    assert.equal(a.status, "fired");
    assert.equal(b.status, "fired");
    assert.equal(a.receipt, b.receipt);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("sse emits one pending event and closes", async () => {
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, 100, now)));
    const res = await streamGET(
      new Request(`${BASE}/v1/stream`, {
        headers: { accept: "text/event-stream", ...G(REAL_TX), ...W("w_btc_10_1h") },
      }),
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /^event: pending\ndata: /);
    assert.equal(text.includes("0.99"), false);
    assert.equal(res.headers.get("X-Harbinger-Correlation"), "n/a");
  });
});

describe("hooks", () => {
  const callback = "https://example.com/harbinger";

  test("registration does not spend; a fire spends once; retry does not; no-move does not deliver", async () => {
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, now === T0 ? 100 : 125, now === T0 ? T0 : now - 20_000)));
    const reg = await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback });
    assert.equal(reg.status, 200);
    assert.deepEqual(await reg.json(), { protocol: "x403-HARBINGER/1.0", accepted: true, watchId: "w_btc_10_1h" });
    assert.ok(reg.headers.get("X-Harbinger-Monitor"));
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
    assert.equal(posts.length, 0);

    const again = await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback });
    assert.equal(again.status, 200);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);

    setNowForTests(T0 + 60_000);
    const ran = (await (await pump()).json()) as { fired: number; delivered: number; signing: string };
    assert.equal(ran.fired, 1);
    assert.equal(ran.delivered, 1);
    assert.equal(ran.signing, "ready");
    assert.equal(posts.length, 1);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
    const ping = JSON.parse(posts[0]!.body) as Fired;
    assert.equal(ping.status, "fired");
    assert.equal(ping.firedAt, new Date(T0 + 60_000 - 20_000).toISOString());
    assert.equal(ping.correlation, null);
    assert.equal(ping.correlationNote, "one-leg");
    const expectSig = "sha256=" + createHmac("sha256", SECRET).update(posts[0]!.body).digest("hex");
    assert.equal(posts[0]!.signature, expectSig);
    assert.equal(posts[0]!.body.includes("example.com"), false);

    const seen = await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") });
    assert.equal(seen.status, 403);
    const hookAgain = await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback });
    assert.equal(hookAgain.status, 403);
    assert.equal(hookAgain.headers.get("X-Harbinger-Forbidden"), "grant-exhausted");
    const hookRepeat = await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback });
    assert.equal(hookRepeat.status, 403);

    const second = (await (await pump()).json()) as { delivered: number; fired: number };
    assert.equal(second.delivered, 0);
    assert.equal(second.fired, 0);
    assert.equal(posts.length, 1);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("delivery retry does not spend a second unit", async () => {
    let n = 0;
    setDeliverForTests(async (job) => {
      posts.push(job);
      n += 1;
      if (n === 1) return { ok: false, status: 500, error: "http-500" };
      return { ok: true, status: 200 };
    });
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, now === T0 ? 80 : 100, now === T0 ? T0 : now - 10_000)));
    assert.equal((await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback })).status, 200);
    setNowForTests(T0 + 60_000);
    const first = (await (await pump()).json()) as { delivered: number; failed: number };
    assert.equal(first.failed, 1);
    assert.equal(first.delivered, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
    const second = (await (await pump()).json()) as { delivered: number; failed: number };
    assert.equal(second.delivered, 1);
    assert.equal(posts.length, 2);
    assert.equal(posts[0]!.body, posts[1]!.body);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("no-move does not deliver and does not spend", async () => {
    useQuotes((symbols, now) => symbols.map((symbol) => q(symbol, 100, now - 15_000)));
    assert.equal((await hooks(G(REAL_TX), { callback, watchId: "w_btc_10_1h" })).status, 200);
    setNowForTests(T0 + HOUR);
    const ran = (await (await pump()).json()) as { noMove: number; delivered: number };
    assert.equal(ran.noMove, 1);
    assert.equal(ran.delivered, 0);
    assert.equal(posts.length, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
    const body = (await (await stream({ ...G(REAL_TX), ...W("w_btc_10_1h") })).json()) as { status: string; firedAt: null };
    assert.equal(body.status, "no-move");
    assert.equal(body.firedAt, null);
    await pump();
    assert.equal(posts.length, 0);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 0);
  });

  test("concurrent pumps deliver once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hits = 0;
    setQuotesForTests(async (symbols, now) => {
      if (now !== T0) {
        hits += 1;
        if (hits >= 2) release();
        await gate;
      }
      return symbols.map((symbol) => q(symbol, now === T0 ? 100 : 150, now === T0 ? T0 : now - 15_000));
    });
    assert.equal((await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback })).status, 200);
    setNowForTests(T0 + 60_000);
    const pair = await Promise.race([
      Promise.all([pump(), pump()]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("concurrent pumps hung")), 2000)),
    ]);
    assert.equal(pair[0].status, 200);
    assert.equal(pair[1].status, 200);
    assert.equal(posts.length, 1);
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used, 1);
  });

  test("bad callback URLs are refused and do not spend", async () => {
    const bad = [
      "http://example.com/hook",
      "https://127.0.0.1/hook",
      "https://localhost/hook",
      "https://10.1.2.3/hook",
      "https://192.168.1.9/hook",
      "https://169.254.169.254/latest",
      "https://user:pass@example.com/hook",
      "not a url",
    ];
    for (const callbackUrl of bad) {
      const res = await hooks(G(REAL_TX), { watchId: "w_btc_10_1h", callback: callbackUrl });
      assert.equal(res.status, 400, callbackUrl);
    }
    assert.equal((await sharedMemoryStore().get(REAL_TX))?.used ?? 0, 0);
    assert.equal(posts.length, 0);
  });

  test("pump rejects a missing or wrong cron secret", async () => {
    assert.equal((await pumpGET(new Request(`${BASE}/api/v1/pump`))).status, 401);
    assert.equal((await pumpGET(new Request(`${BASE}/api/v1/pump`, { headers: { authorization: "Bearer nope" } }))).status, 401);
    delete process.env.CRON_SECRET;
    assert.equal((await pumpGET(new Request(`${BASE}/api/v1/pump`, { headers: { authorization: `Bearer ${CRON}` } }))).status, 401);
  });
});

describe("public claim stays not-live", () => {
  test("webhook cards are still marked not-live", () => {
    const card = publicCard(WATCHES.find((w) => w.id === "w_eth_btc_join")!);
    assert.match(card.webhook?.outbound ?? "", /^not-live/);
  });
});

describe("upstash monitor wire", () => {
  test("fire eval names the monitor key and the grant key", async () => {
    const seen: string[][] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "[]")) as string[];
      seen.push(body);
      if (body[0] === "EVAL" && body.includes("3")) {
        return Response.json({ result: body[body.length - 1] });
      }
      const next = JSON.parse(body[body.length - 1] ?? "{}") as Monitor;
      return Response.json({ result: JSON.stringify({ ok: true, applied: true, monitor: { ...next, version: 2 } }) });
    }) as typeof fetch;
    try {
      const store = new UpstashMonitorStore("https://kv.example/", "tok");
      const monitor: Monitor = {
        id: "mon_test",
        version: 1,
        generation: 1,
        grantKey: REAL_TX,
        grantRaw: `hp1.${REAL_TX}`,
        watchId: "w_btc_10_1h",
        status: "pending",
        startedAt: T0,
        deadlineAt: T0 + HOUR,
        baseline: { asOf: T0, prices: { btc: 100 } },
        samples: [],
        firedAt: null,
        correlation: null,
        correlationNote: null,
        receipt: null,
        ping: { status: "fired", correlation: null, grant: { watchId: "w_btc_10_1h", used: 0, quota: 1, expiresAt: "x" } },
        deliveryBody: null,
        consumed: false,
      };
      await store.create(monitor);
      await store.commit({ expectedVersion: 1, next: { ...monitor, status: "fired" }, op: "fire", now: T0 + 1000 });
      const fire = seen.find((row) => row[0] === "EVAL" && row.includes("fire"));
      assert.ok(fire);
      assert.ok(fire!.some((part) => part === `harbinger:monitor:mon_test`));
      assert.ok(fire!.some((part) => part === `harbinger:grant:${REAL_TX}`));
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("kiln review fixes", () => {
  const lookupWith = (addrs: { address: string; family: number }[]) =>
    new Promise<{ err: unknown; address: unknown }>((resolve) => {
      const fake = (_h: string, _o: { all: true }, cb: (e: null, a: typeof addrs) => void) => cb(null, addrs);
      guardedLookup(fake)("hook.example", {}, (err, address) => resolve({ err, address }));
    });

  test("delivery lookup refuses a hostname that resolves to a private address", async () => {
    const priv = await lookupWith([{ address: "10.0.0.7", family: 4 }]);
    assert.match(String((priv.err as Error)?.message), /callback-blocked-address/);
    const mixed = await lookupWith([{ address: "93.184.215.14", family: 4 }, { address: "::1", family: 6 }]);
    assert.ok(mixed.err);
    const meta = await lookupWith([{ address: "169.254.169.254", family: 4 }]);
    assert.ok(meta.err);
  });

  test("delivery lookup connects to the checked public address", async () => {
    const ok = await lookupWith([{ address: "93.184.215.14", family: 4 }]);
    assert.equal(ok.err, null);
    assert.equal(ok.address, "93.184.215.14");
  });

  test("hostnames that start with fc/fd are not mistaken for IPv6 ULA", () => {
    assert.equal(validateCallbackUrl("https://fcbarcelona.example/hook").ok, true);
    assert.equal(validateCallbackUrl("https://[fd00::1]/hook").ok, false);
    assert.equal(validateCallbackUrl("https://224.0.0.1/hook").ok, false);
  });

  test("monitors read back from Lua get their arrays restored", () => {
    const m = fromLua({ samples: {}, ping: { legs: {}, conditions: {}, delivery: ["stream"], samples: 0 } } as unknown as Monitor);
    assert.deepEqual(m.samples, []);
    const ping = m.ping as Record<string, unknown>;
    assert.deepEqual(ping.legs, []);
    assert.deepEqual(ping.conditions, []);
    assert.deepEqual(ping.delivery, ["stream"]);
    assert.equal(ping.samples, 0);
  });

  test("upstash get() turns a cjson {} samples field back into an array", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({ result: JSON.stringify({ id: "mon_x", status: "pending", samples: {}, ping: null }) })) as typeof fetch;
    try {
      const m = await new UpstashMonitorStore("https://kv.example/", "tok").get("mon_x");
      assert.ok(Array.isArray(m?.samples));
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("vercel.json pump cron fits the Hobby once-a-day limit", async () => {
    const { readFileSync } = await import("node:fs");
    const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { schedule: string }[] };
    for (const c of cfg.crons) {
      const [min, hour] = c.schedule.split(" ");
      assert.match(min!, /^\d+$/);
      assert.match(hour!, /^\d+$/);
    }
  });
});
