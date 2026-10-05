import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as cardsGET } from "../app/api/v1/catalog/cards/route";
import { GET as watchesGET } from "../app/api/v1/watches/route";
import { WATCHES, wellKnown } from "../lib/protocol";
import { publicCard, CARD_DISCLAIMER } from "../lib/catalog";

type Card = Record<string, unknown> & { watchId: string; deliveries: string[] };
const ALLOWED = ["watchId", "title", "description", "priceUsdc", "billing", "triggers", "deliveries", "webhook", "subscribe", "disclaimer"];
const FORBIDDEN = /pnl|hit|score|correlation|fired|advantage|thesis|legs|receipt|grant\b|secret|key/i;

test("GET /v1/catalog/cards -> 200 public JSON, no grant or key", async () => {
  const r = await cardsGET();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/vnd.x403.harbinger+json");
  assert.equal(r.headers.get("X-Harbinger-Version"), "x403-HARBINGER/1.0");
  const body = (await r.json()) as { tier: string; count: number; cards: Card[]; keyed: string; disclaimer: string };
  assert.equal(body.tier, "public");
  assert.equal(body.keyed, "not-available");
  assert.equal(body.count, body.cards.length);
  assert.equal(body.disclaimer, CARD_DISCLAIMER);
});

test("cards mirror /v1/watches ids exactly (no extra SKUs: no EUR/GBP #4, no Pred drafts)", async () => {
  const cards = ((await (await cardsGET()).json()) as { cards: Card[] }).cards.map((c) => c.watchId);
  const watches = ((await (await watchesGET(new Request("https://x/v1/watches"))).json()) as { watches: { id: string }[] }).watches.map((w) => w.id);
  assert.deepEqual(cards, watches);
  assert.equal(cards.length, 18);
  for (const id of ["w_eur_gbp_roc", "w_eurusd_usdchf_inv", "w_aud_nzd_spread", "w_usdjpy_dxy"]) assert.ok(!cards.includes(id), id);
});

test("each card has only the SoT v0 schema fields, price/triggers/disclaimer, nothing performance-like", async () => {
  const cards = ((await (await cardsGET()).json()) as { cards: Card[] }).cards;
  for (const c of cards) {
    for (const k of Object.keys(c)) assert.ok(ALLOWED.includes(k), `${c.watchId}: unexpected field ${k}`);
    for (const k of Object.keys(c)) assert.ok(!FORBIDDEN.test(k), `${c.watchId}: forbidden field ${k}`);
    assert.equal(typeof c.priceUsdc, "number");
    assert.ok(Array.isArray(c.triggers) && (c.triggers as unknown[]).length > 0);
    assert.equal(c.disclaimer, CARD_DISCLAIMER);
    assert.deepEqual(c.subscribe, { stream: "GET /v1/stream", headers: ["X-Harbinger-Watch", "X-Harbinger-Grant"] });
    if (c.deliveries.includes("webhook")) {
      assert.match(String((c.webhook as { outbound: string }).outbound), /^not-live/);
    } else {
      assert.equal(c.webhook, undefined);
    }
  }
});

test("card for w_btc_10_1h matches the live watch", () => {
  const w = WATCHES.find((x) => x.id === "w_btc_10_1h")!;
  const c = publicCard(w);
  assert.equal(c.priceUsdc, 0.22);
  assert.equal(c.billing, "per-ping");
  assert.deepEqual(c.triggers, w.conditions.map((x) => x.event));
  assert.match(c.description, /not a trade tip/);
});

test("well-known advertises the catalog", () => {
  assert.equal(wellKnown("https://www.x403-harbinger.com").catalog, "/v1/catalog/cards");
});
