# Harbinger: Agent Grant and Notification Protocol

- Designation: x403-HARBINGER
- Version: 1.0
- Document: X403-HP-1
- URN: urn:x403:harbinger:1.0
- Media type: application/vnd.x403.harbinger+json
- Well-known: /.well-known/harbinger
- Status code: 403 Forbidden
- Category: Informational
- Published: 2026-09-02
- Editors: nicsins

## Abstract

Harbinger is an HTTP-native protocol that lets one agent charge another for a notification when a named event — or a correlated set of events — occurs. Unpaid callers receive 403 Forbidden until they present a grant. After settlement the edge opens a stream and reports how many milliseconds of advantage the correlation usually buys.

Harbinger is not a pay-for-resource protocol. It is a grant-required notify protocol: discovery for crawlers, watches for intelligence, billing per ping or by session.

## 1. Introduction

Agents already crawl. Agents already trade. What they cannot do cheaply is pay another agent to wake them the instant two or more independent prints line up. Harbinger is that wire: a 403 challenge, a grant, a receipt, then a push.

Implementations MUST speak x403-HARBINGER/1.0 on the version header.

## 2. Terminology

- Publisher: the agent that owns a watch or a listed endpoint.
- Subscriber: the agent that holds a grant and receives pings.
- Grant: a bearer credential in X-Harbinger-Grant. Scheme hp1.
- Watch: named conditions plus a time window and a bill.
- Advantage window: estimated lead, in milliseconds, the join usually buys.
- Crawler: an agent that indexes /.well-known/harbinger and listed paths.
- Rail: an optional delivery adapter. AgentMail is a rail.
- Agency: the persistent catalog of instruments, watches, and swarm roles a publisher patrols.
- Patrol: a live sweep of current and recent prints against the watch book.

## 3. Status-code binding

Harbinger binds to HTTP 403. The server understood the request and refuses it until a valid grant is attached. Repeating the request without a grant MUST fail with the same status.

401 is authentication. 402 is payment-for-a-resource. 403, here, is you are forbidden from this event stream until you hold a Harbinger grant.

Implementations MUST NOT speak HTTP 402 on Harbinger endpoints.

## 4. Grants

A grant is a bearer token of the form `hp1.<payload>`. The 1.0 reference implementation accepts the published demo grant `hp1.demo` and any token that starts with `hp1.`.

Production deployments MUST reject `hp1.demo`.

A mailbox API key is not a grant.

## 5. Handshake

1. Subscriber GET /v1/stream with X-Harbinger-Watch.
2. Edge answers 403 with X-Harbinger-Forbidden: grant-required, plus price, event, and advantage window.
3. Subscriber retries with X-Harbinger-Grant.
4. Edge answers 200 with X-Harbinger-Receipt: settled and opens the stream.

## 6. Headers

| Header | Role |
|---|---|
| X-Harbinger-Version | Protocol id |
| X-Harbinger-Forbidden | Challenge (`grant-required`) |
| X-Harbinger-Grant | Bearer grant |
| X-Harbinger-Receipt | Settlement proof |
| X-Harbinger-Watch | Watch id |
| X-Harbinger-Event | Event name |
| X-Harbinger-Correlation | Join score 0–1 |
| X-Harbinger-Advantage-Window | Lead in ms |
| X-Harbinger-Crawl | Crawler flag |
| X-Harbinger-Price | Quoted price |
| X-Harbinger-Delivery | Rails for this watch (`sse,webhook,agentmail`) |

## 7. Discovery

Publishers MUST serve /.well-known/harbinger as application/vnd.x403.harbinger+json. Crawlers MAY also fetch the alias /.well-known/x403.json, which MUST Link to the canonical document.

Listed endpoints appear at GET /v1/index. Watches appear at GET /v1/watches. The agency catalog appears at GET /v1/agency. The free tape appears at GET /v1/tape and the human desk at /desk. Agency discovery and the last print are public. POST /v1/patrol and GET /v1/stream are grant-required.

## 8. Notify

After a grant, GET /v1/stream with Accept: text/event-stream yields SSE. Accept: application/json yields a single correlate object. Webhooks POST the same object to a subscriber URL.

## 9. Correlation

A watch is logic `all` or `any` over N conditions inside a window. When it fires the edge MUST include X-Harbinger-Correlation (0–1) and X-Harbinger-Advantage-Window (milliseconds). The fee is for the join, not for a single print.

Finance watches in 1.0 are percent-move legs over 1h / 4h / 1d on named instruments (crypto, G10 FX, equities). A canonical example is bitcoin ±10% in one hour. Pairwise rolling Pearson on the same bars MAY be published as context. Those scores are estimates. They MUST NOT be presented as investment advice.

Reserved lanes (news, elections, advertising, sentiment) MAY join a book the same way a percent-move does. They are not live in 1.0.

## 10. Billing

Two modes. Per ping: charge when the watch fires. Session: one grant covers the period, then pings are included. Asset for 1.0 is USDC on Base. Durable mail copies MAY add a surcharge. The subscriber pays Harbinger, not the mailbox vendor.

## 11. Crawlers

A crawler that presents X-Harbinger-Crawl: 1 and a grant MAY fetch listed paths. Unpaid crawls of grant-required endpoints MUST 403. GET /v1/agency and GET /v1/tape MUST remain crawlable without a grant.

## 12. Security considerations

- Grants are bearer. Transmit only on TLS.
- Do not put grants in query strings. Header only.
- Demo grant hp1.demo is for the reference implementation.
- Correlation scores are estimates. They are not investment advice.
- Rate-limit 403s so crawlers cannot probe price cheaply.
- Do not persist mailbox vendor API keys in the protocol document or in client bundles.

## 13. IANA considerations

This memo asks for well-known URI “harbinger” and media type application/vnd.x403.harbinger+json. Until assignment, both are used in the x403 tree as specified here.

## 14. AgentMail rail

AgentMail is an optional delivery adapter. It is not the protocol.

A watch MAY list `agentmail` in its delivery set. After settlement the edge MAY send a structured message:

- subject: `HARBINGER · {event} · {watchId}`
- body: the ping object as text
- metadata keys: `x-harbinger-protocol`, `x-harbinger-watch`, `x-harbinger-receipt`, `x-harbinger-correlation`, `x-harbinger-advantage-window`

Inbound `message.received` events MAY map to Harbinger prints:

- `mail.received` — any authenticated inbound
- `mail.received.8k` — subject or body matches a current report / Form 8-K

Those prints MAY join other conditions inside the watch window (for example: 8-K in mail AND an opening gap).

Normative:

- Implementations MUST NOT treat AgentMail credentials as a Harbinger grant.
- Implementations MUST NOT require AgentMail to implement X403-HP-1.
- SSE remains the hot path. Mail is the durable copy for sleeping agents.
- The edge SHOULD expose POST /v1/rails/agentmail as the webhook intake.

## 15. Agency

The agency is the durable book a swarm patrols.

- Instruments are named prints (symbol, class, venue).
- A watch is one or more legs: instrument, direction, threshold percent, window.
- A patrol scores current and recent bars against every watch, records hit rates, and MAY emit pairwise correlations.
- Scouts collect. Joiners fire AND/OR. Archivists keep history. Heralds still 403 until hp1. Horizon roles are reserved for later lanes.

POST /v1/patrol with a valid grant runs a sweep. GET /v1/agency returns the catalog without spending a grant.

## Citation

nicsins, "Harbinger: Agent Grant and Notification Protocol", X403-HP-1, x403-HARBINGER/1.0, September 2026.
