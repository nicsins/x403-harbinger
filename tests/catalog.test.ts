import { test } from "node:test";
import assert from "node:assert/strict";
import { GET as cardsGET } from "../app/api/v1/catalog/cards/route";
import { GET as watchesGET } from "../app/api/v1/watches/route";
import { WATCHES, wellKnown } from "../lib/protocol";
import { publicCard, CARD_DISCLAIMER } from "../lib/catalog";
import { watchBookById } from "../lib/agency";
import { PAID_NOTIFY } from "../lib/paid-notify";
import { GET as indexGET } from "../app/api/v1/index/route";

type Card = Record<string, unknown> & { watchId: string; deliveries: string[] };
const ALLOWED = ["watchId", "title", "description", "priceUsdc", "billing", "triggers", "deliveries", "webhook", "subscribe", "status", "disclaimer"];
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
  assert.equal(cards.length, 21);
  for (const id of ["w_eur_gbp_roc", "w_eurusd_usdchf_inv", "w_aud_nzd_spread", "w_usdjpy_dxy"]) assert.ok(!cards.includes(id), id);
});

test("each card has only the SoT v0 schema fields, price/triggers/disclaimer, nothing performance-like", async () => {
  PAID_NOTIFY.stream = true;
  PAID_NOTIFY.hooks = true;
  PAID_NOTIFY.agentmail = false;
  const cards = ((await (await cardsGET()).json()) as { cards: Card[] }).cards;
  for (const c of cards) {
    for (const k of Object.keys(c)) assert.ok(ALLOWED.includes(k), `${c.watchId}: unexpected field ${k}`);
    for (const k of Object.keys(c)) assert.ok(!FORBIDDEN.test(k), `${c.watchId}: forbidden field ${k}`);
    assert.equal(typeof c.priceUsdc, "number");
    assert.ok(Array.isArray(c.triggers) && (c.triggers as unknown[]).length > 0);
    assert.equal(c.disclaimer, CARD_DISCLAIMER);
    const price = watchBookById(c.watchId) != null;
    if (!price) {
      assert.equal(c.status, "paused");
      assert.equal(c.subscribe, undefined);
      assert.equal(c.webhook, undefined);
    } else {
      assert.equal(c.status, undefined);
      assert.deepEqual(c.subscribe, { stream: "GET /v1/stream", headers: ["X-Harbinger-Watch", "X-Harbinger-Grant"] });
      if (c.deliveries.includes("webhook")) {
        assert.match(String((c.webhook as { outbound: string }).outbound), /signed POST/);
        assert.doesNotMatch(String((c.webhook as { outbound: string }).outbound), /not-live/);
      } else {
        assert.equal(c.webhook, undefined);
      }
    }
  }
});

test("pausing stream and hooks hides subscribe and webhook again", () => {
  const prev = { ...PAID_NOTIFY };
  PAID_NOTIFY.stream = false;
  PAID_NOTIFY.hooks = false;
  PAID_NOTIFY.agentmail = false;
  try {
    for (const w of WATCHES) {
      const c = publicCard(w) as unknown as Card;
      assert.equal(c.status, "paused");
      assert.equal(c.subscribe, undefined);
      assert.equal(c.webhook, undefined);
    }
  } finally {
    PAID_NOTIFY.stream = prev.stream;
    PAID_NOTIFY.hooks = prev.hooks;
    PAID_NOTIFY.agentmail = prev.agentmail;
  }
});

test("discovery lists the live stream and hooks, and keeps AgentMail send paused", async () => {
  const wk = wellKnown("https://www.x403-harbinger.com") as unknown as { notify: Record<string, unknown> };
  assert.equal(wk.notify.sse, "/v1/stream");
  assert.equal(wk.notify.webhook, "/v1/hooks");
  assert.equal((wk.notify.agentmail as { status?: string }).status, "paused");
  const idx = await indexGET(new Request("https://x/v1/index"));
  assert.equal(idx.status, 200);
  const paths = ((await idx.json()) as { services: { path: string }[] }).services.map((x) => x.path);
  assert.ok(paths.includes("/v1/stream"));
  assert.ok(!paths.includes("/v1/rails/agentmail"));
  const crawled = await indexGET(new Request("https://x/v1/index", { headers: { "X-Harbinger-Crawl": "1" } }));
  assert.equal(crawled.status, 403);
  const { GET: llmsGET } = await import("../app/llms.txt/route");
  const llms = await llmsGET().text();
  assert.match(llms, /GET \/v1\/stream/);
  assert.match(llms, /AgentMail send stays paused/);
});

test("paused flags: well-known and index do not advertise paid notify", async () => {
  const prev = { ...PAID_NOTIFY };
  PAID_NOTIFY.stream = false;
  PAID_NOTIFY.hooks = false;
  PAID_NOTIFY.agentmail = false;
  try {
    const wk = wellKnown("https://www.x403-harbinger.com") as unknown as { notify: Record<string, unknown> };
    assert.equal(wk.notify.status, "paused");
    assert.equal(wk.notify.sse, undefined);
    const idx = await indexGET(new Request("https://x/v1/index", { headers: { "X-Harbinger-Crawl": "1" } }));
    assert.equal(idx.status, 200);
    const paths = ((await idx.json()) as { services: { path: string }[] }).services.map((x) => x.path);
    assert.ok(!paths.includes("/v1/stream") && !paths.includes("/v1/rails/agentmail"));
  } finally {
    PAID_NOTIFY.stream = prev.stream;
    PAID_NOTIFY.hooks = prev.hooks;
    PAID_NOTIFY.agentmail = prev.agentmail;
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
