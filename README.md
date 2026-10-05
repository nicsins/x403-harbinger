# Harbinger

**Designation:** `x403-HARBINGER/1.0`  
**Document:** `X403-HP-1`  
**URN:** `urn:x403:harbinger:1.0`  
**Status:** HTTP 403 Forbidden until grant  
**Live edge:** https://x403-harbinger.vercel.app · https://www.x403-harbinger.com

Harbinger is an HTTP-native protocol that lets one agent charge another for a notification when a named event — or a correlated set of events — occurs.

Unpaid callers receive **403 Forbidden**. Present `X-Harbinger-Grant`. The edge settles and pushes.

This is not pay-for-a-resource. It is grant-required notify. It is not x402.

## Spec

- [SPEC.md](./SPEC.md) — X403-HP-1, the 1.0 memo
- [spec/harbinger-1.0.json](./spec/harbinger-1.0.json) — machine document
- Live: `/.well-known/harbinger`

## Wire format

```
GET /v1/stream
X-Harbinger-Watch: w_btc_10_1h

HTTP/1.1 403 Forbidden
X-Harbinger-Version: x403-HARBINGER/1.0
X-Harbinger-Forbidden: grant-required
X-Harbinger-Price: 0.22 USDC
X-Harbinger-Advantage-Window: 2400ms
```

Retry with:

```
X-Harbinger-Grant: hp1.<payload>
```

Reference demo grant: `hp1.demo`.

## Agency

The agency is a persistent catalog of notification watches a swarm can patrol.

Finance is live: 29 instruments (crypto, G10 FX, equities), 14 named watches, 10 rolling pairs. A watch is a percent-move join over a window — for example bitcoin ±10% in one hour. Scouts pull 7-day hour bars. The joiner scores AND/OR legs. The archivist reports 7-day hit rates. Herald still answers 403 until hp1.

Discovery is public. Live patrol is grant-required.

The public desk (`/desk`, `GET /v1/tape`) publishes last prints for hot coins, G10 FX, and Tesla with no grant. SpaceX, xAI, and X are private — last-reported marks, not live quotes. Correlation watches still 403 until hp1.

```
GET /v1/tape
GET /v1/agency
POST /v1/patrol
X-Harbinger-Grant: hp1.demo
```

News, elections, advertising, and sentiment are reserved lanes. Correlation scores are estimates, not investment advice.

Adjacent swarm-prediction work such as MiroFish is inspiration only. Harbinger sells the join, not a forecast.

## Discovery

| Path | Role |
|---|---|
| `/.well-known/harbinger` | Canonical machine document |
| `/.well-known/x403.json` | Alias that Links to canonical |
| `/v1/index` | Listed services |
| `/v1/watches` | Named watches |
| `/v1/catalog/cards` | Public event cards (price, triggers, disclaimer). No key. |
| `/v1/agency` | Persistent instrument + watch catalog |
| `/v1/tape` | Free last prints — no grant |
| `/v1/patrol` | Live sweep — 403 until grant |
| `/v1/stream` | Notify desk — 403 until grant |
| `/v1/hooks` | Webhook intake |
| `/v1/rails/agentmail` | Durable mail rail. Not the protocol. |
| `/desk` | Human free tape, briefs, live news |
| `/agency` | Human paid watch book |
| `/llms.txt` | Agent-readable site card |

Publishers serve `/.well-known/harbinger` as `application/vnd.x403.harbinger+json`.

## Settlement

- Asset: USDC
- Network: Base (`eip155:8453`)
- payTo: `0xDa1Eab46918882f8656a41cF9fCa80e2415369d1`

### Grant binding (PROPOSED policy, see `lib/grant.ts` `GRANT_POLICY`)

`hp1.<BaseTxHash>` is checked against the watch named in `X-Harbinger-Watch`:

- Grant present but watch missing or unknown: **400**. No grant at all: **403** challenge, unchanged.
- USDC `Transfer` logs to payTo in that tx are summed and must be at least the watch's `priceUsdc`.
- The tx is bound to the first watch it is redeemed on. Other watches get **403** `grant-bound-to-other-watch`.
- per-ping: `floor(paid / price)` pings (max 10), expiring 24h after first use. session: 24h from first use, max 288 requests.
- Spent or expired gets **403** `grant-exhausted` / `grant-expired`. Records are kept, so a tx can never be re-bound.
- `GET /v1/stream` validates and binds with `consume: false`, captures a live baseline, and returns `status: pending` plus `pollAfter`. It does not hold the function open for the watch window.
- A ping is returned only when a sample **after** that baseline crosses the watch's leg thresholds (`all` / `any`, direction, percent). `firedAt` is that sample's provider timestamp. One quota unit is spent then, and only then.
- Correlation is a Pearson over aligned leg returns in the window (same helper as patrol). One leg, or fewer than 8 returns, is `null` / header `n/a`. It is never a hard-coded `0.99`.
- If the window ends with no cross, the body is `status: no-move`, `firedAt: null`, and quota is unchanged. Credit rule, **pending Nic's sign-off**: no consumption and no refund. `X-Harbinger-Rearm: 1` opens another window while quota remains.
- `POST /v1/hooks` registers a callback and does **not** spend a ping. A protected `GET /api/v1/pump` (Vercel Cron, `Authorization: Bearer $CRON_SECRET`) evaluates due monitors and POSTs a signed body. Retries do not spend again. No-move does not POST. Catalog cards still say webhook outbound is **not-live** until a preview probe.
- Patrol and AgentMail send still spend one use per call. Exhausted, expired, cross-watch, and missing-store behavior is unchanged.
- Storage: Upstash Redis REST (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`).
  Dev and preview fall back to in-memory. Production with no store answers tx grants with **503** (fail closed)
  unless `GRANT_STORE=memory` is set on purpose (per-instance only, so replay is possible across instances).

## AgentMail

A delivery adapter. Not auth. Not a grant. Not x402. SSE is the hot path.

## Citation

nicsins, "Harbinger: Agent Grant and Notification Protocol", X403-HP-1, x403-HARBINGER/1.0, September 2026.

## License

MIT
