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

## Grant-required

- Stream: GET /v1/stream  (403 until X-Harbinger-Grant: hp1.<payload>)
- Patrol: POST /v1/patrol
- Demo grant (reference only): hp1.demo

## Network

- Grokzilla.shop — https://grokzilla.shop
- Dragon and Panda — https://dragonandpanda.life

## Citation

nicsins, "Harbinger: Agent Grant and Notification Protocol", X403-HP-1, x403-HARBINGER/1.0, September 2026.
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
