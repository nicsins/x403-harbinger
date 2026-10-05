/**
 * Cut #5: public subset of /v1/catalog/cards.
 * Field set = event card schema v0 in harbinger-biz-ready/PAID_NOTIFY_PRODUCT.md
 * (watchId, title, description, priceUsdc, billing, triggers, deliveries, webhook,
 * subscribe, disclaimer). Public subset rules (HARBINGER_SHIP_STATUS gap #6):
 * price, triggers, disclaimer; no key; no PnL, hit-rates, scores or fire history.
 * The keyed tier (?key=, full + entitlement) is not built: API keys are a later cut.
 */
import { paidPingEligible, type Watch } from "./protocol";

export const CARD_DISCLAIMER = "Informational notify. No PnL promise. Not investment advice.";

export type PublicCard = {
  watchId: string;
  title: string;
  description: string;
  priceUsdc: number;
  billing: Watch["billing"];
  triggers: string[];
  deliveries: Watch["deliveries"];
  webhook?: { register: string; outbound: string };
  /** Absent when the watch is not offered for paid ping. */
  subscribe?: { stream: string; headers: string[] };
  disclaimer: string;
};

export function publicCard(w: Watch): PublicCard {
  const joiner = w.logic === "all" ? " AND " : " OR ";
  if (!paidPingEligible(w)) {
    // Listed, but no paid ping: no subscribe or hook entry points.
    return {
      watchId: w.id,
      title: w.name,
      description: `${w.conditions.map((c) => c.label).join(joiner)}. Listed only: not offered for paid ping.`,
      priceUsdc: w.priceUsdc,
      billing: w.billing,
      triggers: w.conditions.map((c) => c.event),
      deliveries: w.deliveries,
      disclaimer: CARD_DISCLAIMER,
    };
  }
  return {
    watchId: w.id,
    title: w.name,
    description: `${w.conditions.map((c) => c.label).join(joiner)}. Signal threshold notify, not a trade tip.`,
    priceUsdc: w.priceUsdc,
    billing: w.billing,
    triggers: w.conditions.map((c) => c.event),
    deliveries: w.deliveries,
    ...(w.deliveries.includes("webhook")
      ? {
          webhook: {
            register: "POST /v1/hooks",
            // Outbound pump exists, but it has not been preview-probed. Keep this not-live
            // until Nic signs off. Do not flip it on the strength of unit tests alone.
            outbound: "not-live: intake only; outbound delivery unproven",
          },
        }
      : {}),
    subscribe: { stream: "GET /v1/stream", headers: ["X-Harbinger-Watch", "X-Harbinger-Grant"] },
    disclaimer: CARD_DISCLAIMER,
  };
}

export function publicCatalog(watches: Watch[]) {
  return {
    tier: "public" as const,
    count: watches.length,
    cards: watches.map(publicCard),
    keyed: "not-available",
    disclaimer: CARD_DISCLAIMER,
  };
}
