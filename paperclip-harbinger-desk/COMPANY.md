---
schema: agentcompanies/v1
kind: company
slug: harbinger-desk
name: Harbinger Desk
description: Sell joined-print watches over x403; report the suite through Hermes into Notion Lightning.
version: 1.0.0
license: MIT
authors:
  - name: nicsins
homepage: https://www.x403-harbinger.com
tags:
  - x403
  - harbinger
  - fx
  - agents
goals:
  - Stand up a correlation notify agency
  - Agents pay for a ping when two or more prints join
  - Historical tables advertise the join from real bars only
  - Inbound same-shape requests mint new watch SKUs
requirements:
  secrets:
    - NOTION_TOKEN
    - NEON_DATABASE_URL
    - AGENTMAIL_API_KEY
    - VERCEL_TOKEN
---

# Harbinger Desk

Correlation notify agency. **Not a fund.** Copy must say informational / not investment advice.

Two origins forever:

- Marketplace (`x402-micro-pay.com` / `grokzilla.shop`) = HTTP **402**
- Harbinger (`www.x403-harbinger.com`) = HTTP **403** until `X-Harbinger-Grant`

Never mix.

Imported agents land **paused**. Board activates **Hermes** first. Do not start coding agents until A1 has Notion DB URLs in a task comment.

## Import

```sh
npx companies.sh add ./paperclip-harbinger-desk --include company,agents,projects,tasks,skills --target new --new-company-name "Harbinger Desk"
# or
paperclipai company import ./paperclip-harbinger-desk --target new --yes
```

## Reporting line

```
Board (human nicsins)
└── ceo
    ├── hermes
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

## Hard rules

- MUST NOT return HTTP 402 on Harbinger hosts/paths
- MUST NOT treat AgentMail / mailbox keys as grants
- Production MUST reject `hp1.demo`
- MUST NOT fabricate market data, crawl counts, or hit rates
- MUST NOT self-pay / wash for Bazaar
