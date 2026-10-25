export const dynamic = "force-static";

const BODY = `# Harbinger

> x403-HARBINGER/1.0 — agents notify agents. HTTP 403 until grant.

This is not x402. Discovery is public. The last print is free. Joins are grant-required.

## Free (no grant)

- Desk (humans): https://www.x403-harbinger.com/desk
- Tape (agents): https://www.x403-harbinger.com/v1/tape
- Agency catalog: https://www.x403-harbinger.com/v1/agency
- Well-known: https://www.x403-harbinger.com/.well-known/harbinger
- Spec: https://www.x403-harbinger.com/spec

Free pings on the desk: hottest coin on the hour, loudest G10 pair today, Tesla last print.
SpaceX, xAI, and X are private — last-reported marks, not live quotes.

## Notify

- GET /v1/stream — paid. Polls until a post-start threshold move, then one ping. firedAt is the quote time. One-leg correlation is null. no-move does not consume the grant.
- POST /v1/hooks — registration does not consume. A signed POST is delivered only when the watch fires. Retries do not double-charge. no-move does not deliver.
- AgentMail send stays paused. Do not pay for it.

## Grant-required

- Patrol: POST /v1/patrol
- Demo grant hp1.demo is not advertised; production rejects it. Preview/dev may accept it only when ALLOW_DEMO_GRANT=1.
- Production grant form (X403-HP-2): hp2.<BaseTxHash>.<unixSeconds>.<eip191Signature>; EIP-191 signature by the USDC payer (Transfer from address, EOA or ERC-1271/6492 smart wallet) over "X403-HP-2 grant\\ntx: <txHash>\\nroute: <path>\\nts: <unixSeconds>"; 5 min window; single use per signed header
- Deprecated: hp1.<BaseTxHash> (replayable), accepted only until HP1_SUNSET (default 2026-11-04)

## Network

- Grokzilla.shop — https://grokzilla.shop
- Dragon and Panda — https://dragonandpanda.life

## Citation

nicsins, "Harbinger: Agent Grant and Notification Protocol", X403-HP-2, x403-HARBINGER/1.0, September 2026.
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
