import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkGrant,
  usdcPaidInReceipt,
  grantQuota,
  GRANT_POLICY,
  parseTxGrant,
  type GrantWatch,
} from "../lib/grant";
import {
  MemoryGrantStore,
  grantStoreFromEnv,
  UpstashGrantStore,
  applyRedeem,
  applyReserve,
  applyConvert,
  applyRelease,
  REDEEM_LUA,
  RESERVE_LUA,
  CONVERT_LUA,
  RELEASE_LUA,
  type GrantBinding,
  type GrantStore,
} from "../lib/grant-store";
import { CREATE_LUA, FIRE_LUA } from "../lib/monitor-store";
import {
  REAL_TX, MARKET_TX, FAKE_TX, OTHER_TOPIC, fixture, transferLog, synthTx, mockRpc, defaultReceipts, withEnv,
} from "./helpers";

// Prices from the live watch book (lib/agency.ts / lib/protocol.ts).
const W10: GrantWatch = { id: "w_btc_10_1h", priceUsdc: 0.22, billing: "per-ping" };
const W5: GrantWatch = { id: "w_btc_5_1h", priceUsdc: 0.09, billing: "per-ping" };
const OTP: GrantWatch = { id: "w_mail_otp", priceUsdc: 0.02, billing: "per-ping" };
const FX: GrantWatch = { id: "w_fx_dollar_bid", priceUsdc: 0.11, billing: "session" };
const T0 = Date.parse("2026-10-01T15:40:00Z");
const DAY = 24 * 60 * 60 * 1000;

const g = (tx: string) => `hp1.${tx}`;

let rpc: ReturnType<typeof mockRpc>;
let restoreEnv: () => void;
let store: MemoryGrantStore;

beforeEach(() => {
  restoreEnv = withEnv({ VERCEL_ENV: "production" });
  rpc = mockRpc(defaultReceipts());
  store = new MemoryGrantStore();
});
afterEach(() => {
  rpc.restore();
  restoreEnv();
});

const use = (raw: string | null, w: GrantWatch | null, opts: { consume?: boolean; now?: number; id?: string | null } = {}) =>
  checkGrant(raw, opts.id === undefined ? w?.id ?? null : opts.id, w, {
    consume: opts.consume ?? true,
    now: opts.now ?? T0,
    store,
  });

describe("receipt parsing (real Base receipts as fixtures)", () => {
  test("real proof tx pays 0.22 USDC (220000) to payTo", () => {
    assert.equal(usdcPaidInReceipt(fixture(REAL_TX) as never), BigInt(220000));
  });
  test("marketplace settle pays 0.004 USDC (4000); non-Transfer USDC log ignored", () => {
    assert.equal(usdcPaidInReceipt(fixture(MARKET_TX) as never), BigInt(4000));
  });
  test("multiple Transfer logs to payTo are summed; other recipients/tokens ignored", () => {
    const r = {
      status: "0x1",
      logs: [
        transferLog(100000),
        transferLog(120000),
        transferLog(999999, OTHER_TOPIC),
        transferLog(999999, undefined, "0x0000000000000000000000000000000000000001"),
      ],
    };
    assert.equal(usdcPaidInReceipt(r), BigInt(220000));
  });
  test("reverted receipt is null", () => {
    assert.equal(usdcPaidInReceipt({ status: "0x0", logs: [transferLog(220000)] }), null);
  });
  test("parseTxGrant", () => {
    assert.equal(parseTxGrant(g(REAL_TX.toUpperCase().replace("0X", "0x"))), REAL_TX);
    assert.equal(parseTxGrant("hp1.demo"), null);
    assert.equal(parseTxGrant("hp1.0x1234"), null);
  });
});

describe("gap 3: watch required", () => {
  test("valid tx grant with no watch -> 400 watch-required, no RPC spent", async () => {
    const r = await use(g(REAL_TX), null, { id: null });
    assert.deepEqual([r.ok, !r.ok && r.status, !r.ok && r.reason], [false, 400, "watch-required"]);
    assert.equal(rpc.calls.length, 0);
  });
  test("blank watch header -> 400 watch-required", async () => {
    const r = await use(g(REAL_TX), null, { id: "  " });
    assert.equal(!r.ok && r.status, 400);
  });
  test("unknown watch -> 400 unknown-watch", async () => {
    const r = await use(g(REAL_TX), null, { id: "w_nope" });
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [400, "unknown-watch"]);
  });
  test("no grant + no watch stays 403 grant-required (SPEC §3)", async () => {
    const r = await use(null, null, { id: null });
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [403, "grant-required"]);
  });
});

describe("gap 4: value must cover the requested watch's priceUsdc", () => {
  test("real 0.22 tx unlocks w_btc_10_1h (price 0.22) with quota 1", async () => {
    const r = await use(g(REAL_TX), W10);
    assert.ok(r.ok && r.kind === "tx");
    if (r.ok && r.kind === "tx") {
      assert.equal(r.binding.watchId, "w_btc_10_1h");
      assert.equal(r.binding.quota, 1);
      assert.equal(r.binding.used, 1);
      assert.equal(r.binding.paidAtomic, "220000");
      assert.equal(r.binding.expiresAt, T0 + GRANT_POLICY["per-ping"].ttlMs);
    }
  });
  test("marketplace 0.004 settle to the same payTo -> 403 insufficient-payment, not bound", async () => {
    for (const w of [OTP, W5, W10]) {
      const r = await use(g(MARKET_TX), w);
      assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [403, "insufficient-payment"]);
    }
    assert.equal(await store.get(MARKET_TX), null);
  });
  test("0.10 tx below w_btc_10_1h price -> 403; still usable on a watch it covers", async () => {
    const tx = synthTx(10);
    rpc.restore();
    rpc = mockRpc({ ...defaultReceipts(), [tx]: { status: "0x1", logs: [transferLog(100000)] } });
    const r = await use(g(tx), W10);
    assert.equal(!r.ok && r.reason, "insufficient-payment");
    assert.ok((await use(g(tx), W5)).ok);
  });
  test("split payment: two Transfer logs 0.12 + 0.10 = 0.22 unlock w_btc_10_1h", async () => {
    const tx = synthTx(11);
    rpc.restore();
    rpc = mockRpc({ [tx]: { status: "0x1", logs: [transferLog(120000), transferLog(100000)] } });
    assert.ok((await use(g(tx), W10)).ok);
  });
  test("transfer to a different address -> 403 grant-required", async () => {
    const tx = synthTx(12);
    rpc.restore();
    rpc = mockRpc({ [tx]: { status: "0x1", logs: [transferLog(5_000_000, OTHER_TOPIC)] } });
    const r = await use(g(tx), W10);
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [403, "grant-required"]);
  });
});

describe("gaps 1+2: bind to first watch, TTL, quota (replay)", () => {
  test("replay of a 1-ping grant -> 403 grant-exhausted", async () => {
    assert.ok((await use(g(REAL_TX), W10)).ok);
    const r = await use(g(REAL_TX), W10, { now: T0 + 1000 });
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [403, "grant-exhausted"]);
  });
  test("RPC is called once per tx; later uses are served from the binding store", async () => {
    await use(g(REAL_TX), W10);
    await use(g(REAL_TX), W10);
    await use(g(REAL_TX), W5);
    assert.equal(rpc.calls.length, 1);
  });
  test("tx bound to w_btc_10_1h -> 403 on w_btc_5_1h (gap 1)", async () => {
    assert.ok((await use(g(REAL_TX), W10)).ok);
    const r = await use(g(REAL_TX), W5);
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [403, "grant-bound-to-other-watch"]);
  });
  test("first use wins: 0.22 tx first used on w_btc_5_1h binds there (quota 2), then w_btc_10_1h is refused", async () => {
    const a = await use(g(REAL_TX), W5);
    assert.ok(a.ok && a.kind === "tx" && a.binding.quota === 2);
    assert.equal((await use(g(REAL_TX), W10)).ok, false);
    assert.ok((await use(g(REAL_TX), W5)).ok);
    assert.equal((await use(g(REAL_TX), W5)).ok, false);
  });
  test("per-ping overpay buys floor(paid/price) pings; capped at maxUses", async () => {
    const one = synthTx(20), five = synthTx(21);
    rpc.restore();
    rpc = mockRpc({
      [one]: { status: "0x1", logs: [transferLog(1_000_000)] },
      [five]: { status: "0x1", logs: [transferLog(5_000_000)] },
    });
    for (let i = 0; i < 4; i++) assert.ok((await use(g(one), W10)).ok, `use ${i + 1}`);
    assert.equal((await use(g(one), W10)).ok, false);
    const r = await use(g(five), W5);
    assert.ok(r.ok && r.kind === "tx" && r.binding.quota === GRANT_POLICY["per-ping"].maxUses);
  });
  test("use past TTL -> 403 grant-expired (record kept; never re-bindable)", async () => {
    const tx = synthTx(30);
    rpc.restore();
    rpc = mockRpc({ [tx]: { status: "0x1", logs: [transferLog(660000)] } });
    assert.ok((await use(g(tx), W10)).ok);
    assert.ok((await use(g(tx), W10, { now: T0 + DAY - 1 })).ok);
    const late = await use(g(tx), W10, { now: T0 + DAY });
    assert.deepEqual([!late.ok && late.status, !late.ok && late.reason], [403, "grant-expired"]);
    const other = await use(g(tx), W5, { now: T0 + DAY + 1 });
    assert.equal(!other.ok && other.reason, "grant-bound-to-other-watch");
    assert.ok(await store.get(tx));
  });
  test("session watch: 24h window, fair-use cap", async () => {
    const tx = synthTx(40);
    rpc.restore();
    rpc = mockRpc({ [tx]: { status: "0x1", logs: [transferLog(110000)] } });
    const r = await use(g(tx), FX);
    assert.ok(r.ok && r.kind === "tx" && r.binding.quota === GRANT_POLICY.session.maxUses);
    assert.ok((await use(g(tx), FX, { now: T0 + 60_000 })).ok);
    assert.equal((await use(g(tx), FX, { now: T0 + DAY })).ok, false);
    assert.equal(grantQuota(FX, BigInt(110000)), 288);
  });
  test("session fair-use cap exhausts", async () => {
    const tx = synthTx(41);
    rpc.restore();
    rpc = mockRpc({ [tx]: { status: "0x1", logs: [transferLog(110000)] } });
    for (let i = 0; i < GRANT_POLICY.session.maxUses; i++) assert.ok((await use(g(tx), FX, { now: T0 + i })).ok);
    const r = await use(g(tx), FX, { now: T0 + 999 });
    assert.equal(!r.ok && r.reason, "grant-exhausted");
  });
  test("hook registration consumes quota; exhausted and other-watch checks remain enforced", async () => {
    assert.ok((await use(g(REAL_TX), W10, { consume: true })).ok);
    const b = await store.get(REAL_TX);
    assert.equal(b?.used, 1);
    const exhausted = await use(g(REAL_TX), W10, { consume: true });
    assert.deepEqual([!exhausted.ok && exhausted.status, !exhausted.ok && exhausted.reason], [403, "grant-exhausted"]);
    const other = await use(g(REAL_TX), W5, { consume: true });
    assert.deepEqual([!other.ok && other.status, !other.ok && other.reason], [403, "grant-bound-to-other-watch"]);
  });
  test("concurrent first redemptions on two watches: exactly one wins", async () => {
    const [a, b] = await Promise.all([use(g(REAL_TX), W10), use(g(REAL_TX), W5)]);
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  });
});

describe("demo + fake hex (cut #3 behaviour kept)", () => {
  test("hp1.demo rejected on production, with or without watch", async () => {
    assert.deepEqual(await use("hp1.demo", W10), { ok: false, status: 403, reason: "grant-required" });
    assert.equal((await use("hp1.demo", null, { id: null })).ok, false);
  });
  test("hp1.demo accepted in dev/preview (watch still required)", async () => {
    restoreEnv();
    restoreEnv = withEnv({});
    assert.deepEqual(await use("hp1.demo", W10), { ok: true, kind: "demo" });
    assert.equal(!(await use("hp1.demo", null, { id: null })).ok && 400, 400);
  });
  test("well-formed but never-sent 64-hex -> 403 grant-required", async () => {
    const r = await use(g(FAKE_TX), W10);
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [403, "grant-required"]);
  });
  test("garbage hp1.* and empty -> 403", async () => {
    for (const raw of ["hp1.anything", "hp1.0x1234", "Bearer x", "", null]) {
      const r = await use(raw, W10);
      assert.equal(!r.ok && r.status, 403, String(raw));
    }
  });
});

describe("store selection + failure", () => {
  test("production without a durable store -> 503 grant-store-unavailable (fail closed)", async () => {
    const r = await checkGrant(g(REAL_TX), W10.id, W10, { consume: true, now: T0 });
    assert.deepEqual([!r.ok && r.status, !r.ok && r.reason], [503, "grant-store-unavailable"]);
    assert.equal(grantStoreFromEnv({ VERCEL_ENV: "production" }), null);
  });
  test("demo still 403 (not 503) on prod without store", async () => {
    const r = await checkGrant("hp1.demo", W10.id, W10, { consume: true });
    assert.equal(!r.ok && r.status, 403);
  });
  test("env selection", () => {
    assert.equal(grantStoreFromEnv({})?.kind, "memory");
    assert.equal(grantStoreFromEnv({ VERCEL_ENV: "preview" })?.kind, "memory");
    assert.equal(grantStoreFromEnv({ VERCEL_ENV: "production", GRANT_STORE: "memory" })?.kind, "memory");
    assert.equal(grantStoreFromEnv({ VERCEL_ENV: "production", KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" })?.kind, "upstash");
    assert.equal(grantStoreFromEnv({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" })?.kind, "upstash");
  });
  test("store error -> 503", async () => {
    const broken: GrantStore = {
      kind: "upstash",
      get: async () => { throw new Error("down"); },
      redeem: async () => { throw new Error("down"); },
      reserve: async () => { throw new Error("down"); },
      convert: async () => { throw new Error("down"); },
      release: async () => { throw new Error("down"); },
    };
    const r = await checkGrant(g(REAL_TX), W10.id, W10, { consume: true, store: broken });
    assert.equal(!r.ok && r.status, 503);
  });
});

describe("UpstashGrantStore wire (mocked REST)", () => {
  test("redeem sends one atomic EVAL with key + args, parses result", async () => {
    rpc.restore();
    const seen: unknown[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { body?: unknown; headers?: Record<string, string> }) => {
      seen.push({ url, body: JSON.parse(String(init?.body)), auth: init?.headers?.authorization });
      const binding = { watchId: "w_btc_10_1h", quota: 1, used: 1, boundAt: T0, expiresAt: T0 + DAY, paidAtomic: "220000" };
      return Response.json({ result: JSON.stringify({ ok: true, binding }) });
    }) as typeof fetch;
    try {
      const s = new UpstashGrantStore("https://kv.example/", "tok");
      const r = await s.redeem(REAL_TX, "w_btc_10_1h", T0, true, {
        watchId: "w_btc_10_1h", quota: 1, used: 0, boundAt: T0, expiresAt: T0 + DAY, paidAtomic: "220000",
      });
      assert.ok(r.ok && r.binding.used === 1);
      const req = seen[0] as { url: string; body: string[]; auth: string };
      assert.equal(req.url, "https://kv.example");
      assert.equal(req.auth, "Bearer tok");
      assert.equal(req.body[0], "EVAL");
      assert.equal(req.body[2], "1");
      assert.equal(req.body[3], `harbinger:grant:${REAL_TX}`);
      assert.deepEqual(req.body.slice(4, 7), ["w_btc_10_1h", String(T0), "1"]);
      assert.equal(JSON.parse(req.body[7]!).watchId, "w_btc_10_1h");
    } finally {
      globalThis.fetch = orig;
      rpc = mockRpc({});
    }
  });
  test("redeem maps a refusal", async () => {
    rpc.restore();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ result: JSON.stringify({ ok: false, reason: "exhausted" }) })) as typeof fetch;
    try {
      const r = await new UpstashGrantStore("https://kv.example", "t").redeem(REAL_TX, "w_btc_10_1h", T0, true);
      assert.deepEqual(r, { ok: false, reason: "exhausted" });
    } finally {
      globalThis.fetch = orig;
      rpc = mockRpc({});
    }
  });
  test("reserve, convert, and release each EVAL one key and carry no key prefix", async () => {
    rpc.restore();
    const seen: string[][] = [];
    const binding = { watchId: "w_btc_10_1h", quota: 1, used: 0, reserved: 1, boundAt: T0, expiresAt: T0 + DAY, paidAtomic: "220000" };
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "[]")) as string[];
      seen.push(body);
      const op = body[1] ?? "";
      if (op.startsWith("-- harbinger-op:release")) {
        return Response.json({ result: JSON.stringify({ ok: true, released: true, binding: { ...binding, reserved: 0 } }) });
      }
      if (op.startsWith("-- harbinger-op:convert")) {
        return Response.json({ result: JSON.stringify({ ok: true, binding: { ...binding, reserved: 0, used: 1 } }) });
      }
      return Response.json({ result: JSON.stringify({ ok: true, binding }) });
    }) as typeof fetch;
    try {
      const s = new UpstashGrantStore("https://kv.example", "t");
      const held = await s.reserve(REAL_TX, "mon_a", "w_btc_10_1h", T0);
      assert.equal(held.ok && held.binding.reserved, 1);
      const spent = await s.convert(REAL_TX, "mon_a", T0);
      assert.equal(spent.ok && spent.binding.used, 1);
      assert.equal(spent.ok && spent.binding.reserved, 0);
      const dropped = await s.release(REAL_TX, "mon_a");
      assert.equal(dropped.released, true);
      const expectArgv: Record<string, string[]> = {
        reserve: ["mon_a", "w_btc_10_1h", String(T0)],
        convert: ["mon_a", String(T0)],
        release: ["mon_a"],
      };
      for (const op of ["reserve", "convert", "release"] as const) {
        const req = seen.find((row) => row[1]?.startsWith(`-- harbinger-op:${op}`));
        assert.ok(req, op);
        assert.equal(req![0], "EVAL");
        assert.equal(req![2], "1");
        assert.equal(req![3], `harbinger:grant:${REAL_TX}`);
        assert.deepEqual(req!.slice(4), expectArgv[op]);
        assert.equal(req!.some((part) => part.startsWith("preview:") || part.startsWith("dev:")), false);
      }
      for (const script of [REDEEM_LUA, RESERVE_LUA, CONVERT_LUA, RELEASE_LUA, CREATE_LUA, FIRE_LUA]) {
        assert.match(script, /^-- harbinger-op:/);
        assert.equal(script.includes("harbinger:"), false);
        assert.equal(script.includes("preview:"), false);
        assert.equal(script.includes("dev:"), false);
      }
    } finally {
      globalThis.fetch = orig;
      rpc = mockRpc({});
    }
  });
  test("a legacy Upstash row with no reserved field reads as 0", async () => {
    rpc.restore();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        result: JSON.stringify({ watchId: "w_btc_10_1h", quota: 1, used: 0, boundAt: T0, expiresAt: T0 + DAY, paidAtomic: "220000" }),
      })) as typeof fetch;
    try {
      const b = await new UpstashGrantStore("https://kv.example", "t").get(REAL_TX);
      assert.equal(b?.reserved, 0);
      assert.equal(b?.used, 0);
      assert.equal(b?.reservation, undefined);
    } finally {
      globalThis.fetch = orig;
      rpc = mockRpc({});
    }
  });
});

describe("reservation counter", () => {
  const legacy = {
    watchId: "w_btc_10_1h",
    quota: 1,
    used: 0,
    boundAt: T0,
    expiresAt: T0 + DAY,
    paidAtomic: "220000",
  } as GrantBinding;

  test("legacy rows with no reserved field behave as reserved 0", () => {
    const spent = applyRedeem(legacy, "w_btc_10_1h", T0, true);
    assert.equal(spent.result.ok && spent.result.binding.reserved, 0);
    assert.equal(spent.result.ok && spent.result.binding.used, 1);
    const held = applyReserve(legacy, "mon_legacy", "w_btc_10_1h", T0);
    assert.equal(held.result.ok && held.result.binding.used, 0);
    assert.equal(held.result.ok && held.result.binding.reserved, 1);
    assert.equal(held.result.ok && held.result.binding.reservation?.mon_legacy, "held");
  });

  test("reserve, convert, and release are idempotent and never drive reserved below 0", async () => {
    const tx = synthTx(70);
    await store.redeem(tx, "w_btc_10_1h", T0, false, { ...legacy, quota: 1 });
    const held = await store.reserve(tx, "mon_a", "w_btc_10_1h", T0);
    assert.equal(held.ok && held.binding.reserved, 1);
    const again = await store.reserve(tx, "mon_a", "w_btc_10_1h", T0);
    assert.equal(again.ok && again.binding.reserved, 1);
    const blocked = await store.redeem(tx, "w_btc_10_1h", T0, true);
    assert.equal(blocked.ok, false);
    assert.equal(!blocked.ok && blocked.reason, "reserved");
    assert.equal((await store.get(tx))?.used, 0);

    const fired = await store.convert(tx, "mon_a", T0);
    assert.equal(fired.ok && fired.binding.used, 1);
    assert.equal(fired.ok && fired.binding.reserved, 0);
    const refire = await store.convert(tx, "mon_a", T0);
    assert.equal(refire.ok && refire.idempotent, true);
    assert.equal((await store.get(tx))?.used, 1);
    assert.equal((await store.get(tx))?.reserved, 0);

    const dropped = await store.release(tx, "mon_a");
    assert.equal(dropped.released, false);
    assert.equal(dropped.binding?.reserved, 0);
    const converted = applyConvert(fired.ok ? fired.binding : null, "mon_a", T0);
    assert.equal(converted.result.ok && converted.result.idempotent, true);
    const released = applyRelease(converted.next, "mon_other");
    assert.equal(released.result.released, false);
    assert.equal(released.next?.reserved, 0);
  });

  test("a direct spend is reserved while a hold remains, and exhausted once reserved is 0", async () => {
    const tx = synthTx(71);
    await store.redeem(tx, "w_btc_10_1h", T0, false, { ...legacy, quota: 2, paidAtomic: "440000" });
    assert.ok((await store.reserve(tx, "mon_b", "w_btc_10_1h", T0)).ok);
    assert.ok((await store.redeem(tx, "w_btc_10_1h", T0, true)).ok);
    const second = await store.redeem(tx, "w_btc_10_1h", T0, true);
    assert.equal(!second.ok && second.reason, "reserved");
    const b = await store.get(tx);
    assert.equal(b?.used, 1);
    assert.equal(b?.reserved, 1);
    assert.ok((await store.release(tx, "mon_b")).released);
    assert.ok((await store.redeem(tx, "w_btc_10_1h", T0, true)).ok);
    const done = await store.redeem(tx, "w_btc_10_1h", T0, true);
    assert.equal(!done.ok && done.reason, "exhausted");
    assert.equal((await store.get(tx))?.reserved, 0);
    assert.equal((await store.get(tx))?.used, 2);
  });
});
