/**
 * Read-only live check against public Base RPC (mainnet.base.org): no writes, no sends.
 * Skip with HARBINGER_SKIP_LIVE=1 when offline.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { usdcPaidToPayTo, checkGrant, type GrantWatch } from "../lib/grant";
import { MemoryGrantStore } from "../lib/grant-store";
import { REAL_TX, MARKET_TX, FAKE_TX } from "./helpers";

const skip = process.env.HARBINGER_SKIP_LIVE === "1";
const W10: GrantWatch = { id: "w_btc_10_1h", priceUsdc: 0.22, billing: "per-ping" };
const W5: GrantWatch = { id: "w_btc_5_1h", priceUsdc: 0.09, billing: "per-ping" };
const OTP: GrantWatch = { id: "w_mail_otp", priceUsdc: 0.02, billing: "per-ping" };

describe("live Base receipts (read-only)", { skip }, () => {
  test("real proof tx: 220000 atomic USDC to payTo", async () => {
    assert.equal(await usdcPaidToPayTo(REAL_TX), BigInt(220000));
  });
  test("marketplace settle: 4000 atomic USDC to payTo", async () => {
    assert.equal(await usdcPaidToPayTo(MARKET_TX), BigInt(4000));
  });
  test("full gate on live receipts: bind, replay, cross-watch, marketplace, fake", async () => {
    const store = new MemoryGrantStore();
    const now = Date.now();
    const go = (tx: string, w: GrantWatch) => checkGrant(`hp1.${tx}`, w.id, w, { consume: true, store, now });
    assert.ok((await go(REAL_TX, W10)).ok);
    assert.equal((await go(REAL_TX, W10)).ok, false);
    assert.equal((await go(REAL_TX, W5)).ok, false);
    const m = await go(MARKET_TX, OTP);
    assert.equal(!m.ok && m.reason, "insufficient-payment");
    const f = await go(FAKE_TX, W10);
    assert.equal(!f.ok && f.reason, "grant-required");
  });
});
