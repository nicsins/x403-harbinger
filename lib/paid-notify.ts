/**
 * Paid-notify kill switch (Oct 10 2026 hotfix).
 *
 * The paid stream / hook / AgentMail-send deliveries used to emit an immediate
 * placeholder ping (hard-coded correlation 0.99, firedAt = request time) instead
 * of waiting for a real move. Until the real-move trigger ships, these paid
 * endpoints answer 503 `paid-notify-paused` BEFORE any grant check: no 403
 * payment challenge, no payTo/price advert, no grant redemption or consumption.
 *
 * Deliberately NOT env-controlled: only the real-move trigger code path may flip
 * `live` back to true (in code, reviewed in its own PR). Tests flip it locally to
 * keep exercising grant semantics.
 */

export const PAID_NOTIFY: { live: boolean } = { live: false };

export const PAID_NOTIFY_PAUSED_REASON = "paid-notify-paused";

export function paidNotifyLive(): boolean {
  return PAID_NOTIFY.live === true;
}
