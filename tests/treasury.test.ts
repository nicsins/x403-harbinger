import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { usdcPaidInReceipt, PAY_TO, LEGACY_PAY_TO, grantAdvert } from "../lib/grant";
import { PAY_TO as PROTOCOL_PAY_TO } from "../lib/protocol";
import { assertChecksumAddress, DEFAULT_TREASURY_ADDRESS, toChecksumAddress } from "../lib/treasury";
import { transferLog, PAY_TO_TOPIC as LEGACY_TOPIC, OTHER_TOPIC } from "./helpers";

const NEW_TOPIC = "0x000000000000000000000000c22f9caebac37fe72d5142f35f21f6696ea9ef69";
const LEGACY = "0xDa1Eab46918882f8656a41cF9fCa80e2415369d1";

describe("treasury", () => {
  afterEach(() => {
    delete process.env.LEGACY_PAY_TO_MAX_BLOCK;
  });

  test("defaults to owner wallet; both modules agree", () => {
    assert.equal(DEFAULT_TREASURY_ADDRESS, "0xc22f9CAEBAc37fE72D5142f35f21f6696Ea9Ef69");
    assert.equal(PAY_TO, DEFAULT_TREASURY_ADDRESS);
    assert.equal(PROTOCOL_PAY_TO, DEFAULT_TREASURY_ADDRESS);
    assert.deepEqual([...LEGACY_PAY_TO], [LEGACY]);
  });

  test("checksum validation", () => {
    assert.equal(toChecksumAddress(LEGACY.toLowerCase()), LEGACY);
    assert.equal(assertChecksumAddress(DEFAULT_TREASURY_ADDRESS), DEFAULT_TREASURY_ADDRESS);
    for (const bad of ["", "0x123", "0x" + "0".repeat(40), DEFAULT_TREASURY_ADDRESS.toLowerCase()]) {
      assert.throws(() => assertChecksumAddress(bad));
    }
  });

  test("receipts to new treasury and to legacy (historical) both count; others don't", () => {
    assert.equal(usdcPaidInReceipt({ status: "0x1", logs: [transferLog(1000, NEW_TOPIC)] }), BigInt(1000));
    assert.equal(usdcPaidInReceipt({ status: "0x1", logs: [transferLog(2000, LEGACY_TOPIC)] }), BigInt(2000));
    assert.equal(usdcPaidInReceipt({ status: "0x1", logs: [transferLog(3000, OTHER_TOPIC)] }), BigInt(0));
  });

  test("LEGACY_PAY_TO_MAX_BLOCK limits legacy credit to settled-before-cutover txs", () => {
    process.env.LEGACY_PAY_TO_MAX_BLOCK = "100";
    const legacy = (bn: string) => ({ status: "0x1", blockNumber: bn, logs: [transferLog(2000, LEGACY_TOPIC)] });
    assert.equal(usdcPaidInReceipt(legacy("0x64")), BigInt(2000));
    assert.equal(usdcPaidInReceipt(legacy("0x65")), BigInt(0));
    assert.equal(usdcPaidInReceipt({ status: "0x1", blockNumber: "0x65", logs: [transferLog(1000, NEW_TOPIC)] }), BigInt(1000));
  });

  test("legacy address is never advertised", () => {
    assert.ok(!JSON.stringify(grantAdvert("x")).toLowerCase().includes("da1eab"));
    const root = join(__dirname, "..");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        if (["node_modules", ".next", ".git", "tests"].includes(f)) continue;
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|md|txt|json)$/.test(f) && p !== join(root, "lib", "treasury.ts")) {
          if (readFileSync(p, "utf8").toLowerCase().includes("da1eab46918882f8656a41cf9fca80e2415369d1")) hits.push(p);
        }
      }
    };
    walk(root);
    assert.deepEqual(hits, []);
  });
});
