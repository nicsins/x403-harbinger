# Harbinger Desk — Paperclip agency deployment

**Give this file to your Boss / CEO agent.** Import the sibling folder `paperclip-harbinger-desk/` into Paperclip (Agent Companies `agentcompanies/v1`). Then execute the prompt at the bottom.

Format: [Agent Companies](https://github.com/paperclipai/paperclip/blob/master/docs/companies/companies-spec.md) + Paperclip sidecar `.paperclip.yaml`.
Import:

```sh
npx companies.sh add ./paperclip-harbinger-desk --include company,agents,projects,tasks,skills --target new --new-company-name "Harbinger Desk"
# or
paperclipai company import ./paperclip-harbinger-desk --target new --yes
```

Imported agents/routines should land **paused**. Board activates Hermes first.

---

## 0. What already exists (do not rediscover)

| Thing | State (2026-09-03, America/Chicago) |
|---|---|
| `https://www.x403-harbinger.com/.well-known/harbinger` | Live, `x403-HARBINGER/1.0` |
| Unpaid `GET /v1/stream` | HTTP **403** `grant-required` |
| `/v1/watches` | Demo: ETH funding, BTC whale, 8-K+gap, mail. **No FX yet** |
| `/edge` | **404** |
| Apex `x403-harbinger.com` | A `10.0.1.2`; TLS still flaky |
| `www` CNAME | Vercel (`cname.vercel-dns.com` / `cname.vercel-dns-0.com`) |
| Marketplace | `https://x402-micro-pay.com` / `https://grokzilla.shop` — x402 USDC Base, **no Harbinger partner row** |
| Repos | `nicsins/x403-harbinger`, `nicsins/ai-micro-pay` |
| Vercel team | `nic-s-projects-33d61015` |
| Pay to | `0xDa1Eab46918882f8656a41cF9fCa80e2415369d1` USDC `eip155:8453` |
| GoDaddy | Parking gone; NS `ns59/ns60.domaincontrol.com` |

Two origins forever: marketplace = HTTP 402; Harbinger = HTTP 403. Never mix.

---

## 1. Company goal

Stand up a **correlation notify agency**: agents pay for a ping when two or more prints join (FX ROC, later crypto/filings). Historical tables advertise the join. Inbound “same shape, different pairs” requests mint new watch SKUs.

This is **not** a fund. Correlation and advantage-window are estimates. Copy must say informational / not investment advice.

---

## 2. Org (JSON roster)

Use slugs as portable ids. After import, replace `reportsTo` with the created UUIDs. Paperclip roles: `ceo|cto|engineer|designer|pm|qa|devops|researcher|general`.

```json
{
  "schema": "agentcompanies/v1",
  "company": {
    "slug": "harbinger-desk",
    "name": "Harbinger Desk",
    "primaryInitiative": "Sell joined-print watches over x403; report the suite through Hermes into Notion Lightning"
  },
  "agents": [
    {
      "slug": "ceo",
      "name": "Desk CEO",
      "role": "ceo",
      "title": "Chief Executive Officer",
      "reportsTo": null,
      "adapterType": "cursor",
      "budgetMonthlyCents": 150000,
      "skills": ["harbinger-protocol", "notion-lightning-report"],
      "capabilities": "Strategy, delegation, board communication. Does not write production code."
    },
    {
      "slug": "hermes",
      "name": "Hermes",
      "role": "pm",
      "title": "Suite Reporting Officer (Notion Lightning)",
      "reportsTo": "ceo",
      "adapterType": "hermes_local",
      "budgetMonthlyCents": 40000,
      "heartbeatIntervalSec": 300,
      "skills": ["notion-lightning-report", "harbinger-protocol"],
      "capabilities": "Probes live endpoints and writes Suite Status, Watch Catalog, Agent Requests, Incidents, Daily Lightning. Only Notion writer. Does not ship code.",
      "tools": ["Notion MCP", "HTTP GET probes", "Paperclip tasks/comments"],
      "secrets": ["NOTION_TOKEN"]
    },
    {
      "slug": "cto",
      "name": "CTO",
      "role": "cto",
      "title": "Chief Technology Officer",
      "reportsTo": "ceo",
      "adapterType": "cursor",
      "budgetMonthlyCents": 80000,
      "skills": ["harbinger-protocol", "no-402-on-403"],
      "capabilities": "Two-origin architecture, Next.js on Vercel, protocol fights, issue breakdown."
    },
    {
      "slug": "harbinger-engineer",
      "name": "Harbinger Engineer",
      "role": "engineer",
      "title": "Edge Engineer",
      "reportsTo": "cto",
      "adapterType": "cursor",
      "budgetMonthlyCents": 60000,
      "skills": ["harbinger-protocol", "fx-watch-sku", "no-402-on-403"],
      "capabilities": "Next.js App Router edge: well-known, watches, SSE, grants. Rejects hp1.demo in prod."
    },
    {
      "slug": "marketplace-engineer",
      "name": "Marketplace Engineer",
      "role": "engineer",
      "title": "x402 Listing Engineer",
      "reportsTo": "cto",
      "adapterType": "cursor",
      "budgetMonthlyCents": 40000,
      "skills": ["x402-list-partner"],
      "capabilities": "hosted_partners row on x402-micro-pay.com. Pay-here / notify-there."
    },
    {
      "slug": "correlation-quant",
      "name": "Correlation Quant",
      "role": "researcher",
      "title": "Join Designer",
      "reportsTo": "cto",
      "adapterType": "cursor",
      "budgetMonthlyCents": 40000,
      "skills": ["fx-watch-sku"],
      "capabilities": "Watch SKUs, historical join tables, similar-join intake. Never fabricates candles or hit rates."
    },
    {
      "slug": "data-core",
      "name": "Data Core",
      "role": "engineer",
      "title": "Market Data Engineer",
      "reportsTo": "cto",
      "adapterType": "cursor",
      "budgetMonthlyCents": 40000,
      "skills": ["fx-watch-sku"],
      "capabilities": "FX majors + DXY ingest to Neon. Live ROC prints. Blocks if feed missing.",
      "secrets": ["NEON_DATABASE_URL"]
    },
    {
      "slug": "protocol-qa",
      "name": "Protocol QA",
      "role": "qa",
      "title": "X403-HP-1 Conformance",
      "reportsTo": "cto",
      "adapterType": "process",
      "budgetMonthlyCents": 15000,
      "skills": ["harbinger-protocol", "no-402-on-403"],
      "capabilities": "Release gate: 403 only, media type, no demo grant in prod."
    },
    {
      "slug": "growth",
      "name": "Growth / Crawler",
      "role": "general",
      "title": "Discovery Lead",
      "reportsTo": "ceo",
      "adapterType": "cursor",
      "budgetMonthlyCents": 25000,
      "skills": ["x402-list-partner"],
      "capabilities": "Bazaar metadata on marketplace pay path, x402scan, llms.txt. One real CDP settlement, no wash."
    },
    {
      "slug": "rails",
      "name": "Rails",
      "role": "engineer",
      "title": "AgentMail Rail",
      "reportsTo": "cto",
      "adapterType": "cursor",
      "budgetMonthlyCents": 20000,
      "skills": ["harbinger-protocol"],
      "capabilities": "Optional mail copy. Keys never grants. SSE remains hot path.",
      "secrets": ["AGENTMAIL_API_KEY"]
    },
    {
      "slug": "edge-designer",
      "name": "Edge Designer",
      "role": "designer",
      "title": "/edge Table Designer",
      "reportsTo": "ceo",
      "adapterType": "cursor",
      "budgetMonthlyCents": 15000,
      "skills": ["fx-watch-sku"],
      "capabilities": "Human /edge table. No fake PnL."
    },
    {
      "slug": "devops",
      "name": "DevOps",
      "role": "devops",
      "title": "DNS / TLS / Vercel",
      "reportsTo": "cto",
      "adapterType": "cursor",
      "budgetMonthlyCents": 15000,
      "skills": ["no-402-on-403"],
      "capabilities": "Apex TLS, GoDaddy records, Vercel domain attach. No forwarding.",
      "secrets": ["VERCEL_TOKEN"]
    }
  ]
}
```

Reporting line:

```
Board (human nicsins)
└── ceo
    ├── hermes          ← Notion Lightning for the whole suite
    ├── growth
    ├── edge-designer
    └── cto
        ├── harbinger-engineer
        ├── marketplace-engineer
        ├── correlation-quant
        ├── data-core
        ├── protocol-qa
        ├── rails
        └── devops
```

---

## 3. Skills / connectors / tools to build

| Skill slug | Why |
|---|---|
| `harbinger-protocol` | X403-HP-1 headers, well-known, 403 stream |
| `fx-watch-sku` | Join watch JSON + no fake history |
| `notion-lightning-report` | Hermes DBs + Daily Lightning |
| `x402-list-partner` | Marketplace catalog row |
| `no-402-on-403` | Release gate |

**Connectors (already in operator world — wire, do not paste tokens):** Notion (Lightning), GitHub, Vercel, GoDaddy (DNS is manual; plugin is names-only), Cloudflare, AgentMail, Neon, Coinbase CDP / x402 facilitator.

**Tools / cmds agents should run (no secrets in logs):**

```sh
curl -sI https://www.x403-harbinger.com/v1/stream
curl -s https://www.x403-harbinger.com/.well-known/harbinger
curl -s https://www.x403-harbinger.com/v1/watches
curl -sI https://x403-harbinger.com/.well-known/harbinger
curl -s https://x402-micro-pay.com/api/catalog | python3 -c "import sys,json; d=json.load(sys.stdin); print('harbinger' in json.dumps(d).lower())"
```

**Still to build in product:**

1. `/edge` page
2. FX watch ids on `/v1/watches`
3. Historical join table generator (real candles only)
4. Live ROC printer
5. Similar-join intake → new SKU
6. Marketplace partner listing
7. Production grant signer (reject `hp1.demo`)
8. Hermes Notion DBs
9. Apex cert
10. Optional AgentMail rail

---

## 4. Concurrent multi-task plan

Paperclip rule: **one assignee per task, atomic checkout.** Waves A tasks run **at the same time**. B waits on A4/B1 as noted. C after B. D independent of C except growth can start after A5.

### Wave A — start together (P0/P1)

| ID | Assignee | Outcome |
|---|---|---|
| A1 | hermes | Notion DBs + first probe written |
| A2 | devops | Apex HTTPS well-known 200 |
| A3 | edge-designer | `/edge` 200 |
| A4 | correlation-quant | Four FX watch JSON specs |
| A5 | marketplace-engineer | Catalog contains harbinger |

### Wave B — after A4 (and B1 for history)

| ID | Assignee | Blocked on | Outcome |
|---|---|---|---|
| B1 | data-core | feed availability | Neon OHLC+ROC |
| B2 | harbinger-engineer | A4 | `/v1/watches` lists FX ids |
| B3 | correlation-quant | B1 | History table, no invented rates |
| B4 | protocol-qa | B2 | 403-only evidence |

### Wave C

| ID | Assignee | Blocked on | Outcome |
|---|---|---|---|
| C1 | data-core | B1+B2 | Live ROC prints / documented gap |
| C2 | correlation-quant | A1 | Similar-join intake → Agent Requests |

### Wave D — parallel with C

| ID | Assignee | Outcome |
|---|---|---|
| D1 | growth | Real CDP settlement + x402scan (no wash) |
| D2 | rails | Optional AgentMail rail |

### Recurring

Hermes weekday `0 8 * * 1-5` America/Chicago — probe, Notion, 5-line task comment. Stay quiet elsewhere unless Sev-1 (402 on Harbinger, apex down, grant leak).

---

## 5. First FX SKUs (agency product)

1. `w_eur_gbp_roc` — EURUSD ROC ∧ GBPUSD ROC same sign, ~5m
2. `w_eurusd_usdchf_inv` — EURUSD up ∧ USDCHF down
3. `w_aud_nzd_spread` — AUDUSD vs NZDUSD spread blowout
4. `w_usdjpy_dxy` — USDJPY ROC ∧ DXY ROC

Fee is for the **join**. Buyer agent decides action.

---

## 6. Hard rules

- MUST NOT return HTTP 402 on Harbinger hosts/paths
- MUST NOT treat AgentMail / mailbox keys as grants
- Production MUST reject `hp1.demo`
- MUST NOT fabricate market data, crawl counts, or hit rates
- MUST NOT self-pay / wash for Bazaar
- Secrets only in Paperclip secret store / connect cards
- Communication = Paperclip tasks + comments; Hermes mirrors to Notion

---

## 7. Boss agent prompt (paste this)

You are the Paperclip **Desk CEO** for company **Harbinger Desk**.

Import/hire the agents in this file. Activate **Hermes** first with Notion Lightning. Do not start coding agents until A1 has DB URLs in a task comment.

Then check out Wave A tasks concurrently (A1–A5), one agent each. Do not assign two agents to one issue.

Use live facts in section 0. Re-probe; do not trust stale TLS or catalog claims.

Protocol: Harbinger is x403 (403 until `X-Harbinger-Grant`). Marketplace is x402. Two origins.

When Wave A is green, unlock Wave B. Report only through Hermes → Notion plus comments on the parent initiative.

If Cloud Agents / GitHub write access is missing, create a Board task for the human instead of looping.

Go.
