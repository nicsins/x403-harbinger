# Grok Build report: real-move paid ping

Branch: `kiln/real-move-ping-v2` (local only; not pushed).
Base: `23302357` (hotfix #10 on `f402ca9d`).

## Result

`GET /v1/stream` and `POST /v1/hooks` now wait for a real post-start threshold move on the watch's price legs. The placeholder `settledPing` (`correlation: 0.99`, `firedAt = now`) is deleted and is not exported. A grant unit is consumed only inside the pending-to-fired transition. `no-move` leaves usage unchanged and creates no refund (Nic, 10 Oct 2026).

AgentMail `send` stays paused. Mail watches (`w_eth_funding`, `w_btc_whale`, `w_sec_mail`, `w_mail_otp`) return `400 watch-not-on-price-trigger` before `checkGrant`, so the tx is not bound by them.

## Live vs paused

| Surface | State |
| --- | --- |
| `GET /v1/stream` | Live for price watches. JSON `202` pending, then `200` fired or `no-move`. SSE sends one event and closes. |
| `POST /v1/hooks` and `GET /v1/hooks` | Live for price watches. Registration does not consume. The cron pump delivers one signed POST on fire. |
| `GET /api/cron/notify-pump` | Implemented. Fail-closed `503 cron-secret-missing` until `CRON_SECRET` is set. Bearer must match. |
| AgentMail `send` | Paused. `503 paid-notify-paused` before any grant check. Unlisted. |
| Mail watches on stream/hooks | Refused (`watch-not-on-price-trigger`). Catalog `status: "paused"`. |
| `POST /v1/patrol` | Unchanged. Still consumes on the request. |

Discovery follows the same split. Price watches advertise `subscribe` and, when the watch lists webhook, an outbound string that describes the pump. Mail watches stay `paused`. `/.well-known/harbinger`, `/v1/index`, and `llms.txt` list stream and hooks and keep AgentMail send paused. There is no env var that turns a paused rail back on. Tests may flip `PAID_NOTIFY.stream`, `PAID_NOTIFY.hooks`, and `PAID_NOTIFY.agentmail`.

## Tests and build

- Baseline on `2330235` before these edits: **71 pass, 0 fail** (13 suites).
- Final `npm test`: **93 pass, 0 fail** (16 suites, ~700ms). Delta is 22 tests: 21 in `tests/trigger.test.ts`, 1 catalog test that pausing stream and hooks hides subscribe and webhook.
- `npx next build`: success (Next.js 15.5.7). Compiled, types checked, 19 static pages generated. `/api/cron/notify-pump` is dynamic.
- No `package-lock.json` added. Treasury / legacy payTo tests were not weakened. The paused-endpoint test still shows a paused rail does not redeem or consume a grant.
- No browser tools in this session. `/spec` and `/notify` copy was checked in source. Route behavior was checked by the node test suite.

## Behavior pinned by tests

1. First stream request is `202` pending and does not increment quota.
2. A later post-start cross returns one ping, `firedAt` equal to the quote timestamp (not the request time), leg measurements, and exactly one quota increment. Replay with `X-Harbinger-Monitor` returns that ping. Without the header, a spent grant is `403 grant-exhausted`.
3. `any` / `all`, direction, threshold, and the watch deadline behave as the watch book. Partial `all` hits are not latched. Samples at or before start, after the deadline, stale, or in error cannot fire.
4. Multi-leg correlation is the mean pairwise Pearson from `lib/score.ts` (null below 8 aligned returns). One-leg correlation is `null` with note `n/a`. The value `0.99` is not produced.
5. Deadline with no match returns `no-move`, `firedAt: null`, `consumed: false`, and a second poll does not consume.
6. Concurrent polls and concurrent pump runs produce one fire and one consumption.
7. Binding, exhausted, cross-watch, expiry, insufficient payment, and production-without-store `503` stay in place.
8. Hook registration does not consume. The pump consumes once on fire. A failed delivery retry POSTs again and does not consume again. `no-move` does not POST.
9. Stale and provider-error samples do not fire, including at the deadline.

Quote source is Yahoo `interval=1m&range=1d`: `regularMarketPrice` + `regularMarketTime`, else the last 1-minute close. Patrol still uses 60-minute bars and is not a fire source. A print older than 3 minutes (`QUOTE_MAX_AGE_MS`) or more than 15 seconds ahead of now is stale. That is about a one-minute print, not a tick.

Durable state uses the same Upstash REST database as grants (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`). Production without that store fails closed for tx grants. Fire and the grant increment are one memory critical section or one Upstash `EVAL`. `no-move` does not touch the grant key.

Hook callbacks must be `https`, with no userinfo, and must not be loopback, link-local, private, CGNAT, or metadata. Delivery resolves DNS and refuses the POST if any address is private. Redirects are not followed. The body is HMAC-SHA256 (`X-Harbinger-Signature: sha256=<hex>`) with a per-hook secret returned at registration. Five attempts, 20s claim lock, backoff 30s doubling, capped at 15 minutes.

## Files

New:

- `lib/clock.ts`
- `lib/markets.ts` (quote parser added in the existing file)
- `lib/live-quote.ts`
- `lib/trigger.ts`
- `lib/hook-delivery.ts`
- `lib/monitor-store.ts`
- `lib/notify-run.ts`
- `app/api/cron/notify-pump/route.ts`
- `vercel.json`
- `tests/trigger.test.ts`
- `GROK_BUILD_REPORT.md`

Changed:

- `lib/agency.ts` (`watchBookById`)
- `lib/grant-store.ts` (shared Upstash REST helper and grant key prefix)
- `lib/grant.ts` (comment only)
- `lib/paid-notify.ts` (per-endpoint switches)
- `lib/protocol.ts` (discovery; `settledPing` removed)
- `lib/catalog.ts`
- `app/api/v1/stream/route.ts`
- `app/api/v1/hooks/route.ts`
- `app/api/v1/index/route.ts`
- `app/api/v1/agentmail/route.ts`
- `app/llms.txt/route.ts`
- `app/spec/page.tsx`
- `app/notify/page.tsx`
- `README.md`
- `SPEC.md`
- `tests/helpers.ts`
- `tests/routes.test.ts`
- `tests/catalog.test.ts`

`next-env.d.ts` was rewritten by `next build` with a reference to `.next/types/routes.d.ts` and was restored. It is not part of this change.

## Not done

- No preview deploy, no `vercel`, no `gh`, no push, no production contact (`x403-harbinger.com`).
- Preview URL: none.
- Forge re-probe: not run. The supervisor deploys the preview and runs that checklist.
- No payments and no grants created.
- No live Yahoo call in tests (the quote parser and a fetcher injection cover the path).

## Decisions still needing Nic

1. Production deploy still needs Nic's explicit go. This branch is preview-only.
2. Set `CRON_SECRET` on the preview or the pump stays `503`. `vercel.json` schedules `* * * * *`. Hobby cron is often daily only; if this project is on that limit, hook delivery waits for the next allowed run. Stream clients poll themselves and do not need the cron.
3. A stale or missing quote at open returns `503` and consumes nothing, but `checkGrant` has already bound the tx to that watch (`used` stays 0). The same watch can be retried. Another watch is `403 grant-bound-to-other-watch`. An invalid callback is the same shape: bound, not consumed, `400 callback-invalid`.
4. Consumption happens when the threshold is observed, not when the HTTP delivery succeeds. A DNS rebind at delivery time sends no POST and does not refund the unit. `no-move` is the only terminal that leaves the grant unspent.
5. If patrol (or anything else) spends the last unit while a monitor is still pending, the pump leaves that monitor pending and counts an error. It does not invent a fire.
6. The monitor deadline is the watch window (`windowMinutes` on the watch). `w_risk_off` is 1440 minutes while its BTC leg is labeled 240 minutes. A post-start move versus the opening baseline counts for the whole watch window. Say if that leg should expire on its own shorter window.
