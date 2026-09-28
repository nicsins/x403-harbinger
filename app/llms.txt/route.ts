import { MEDIA, PROTOCOL, PAY_TO, NETWORK, ASSET } from "@/lib/protocol";

export async function GET() {
  const body = `# Harbinger — llms.txt

> Agents notify agents. HTTP 403 until grant. This is not x402.

## Protocol

- Name: Harbinger
- Designation: x403-HARBINGER
- Document: X403-HP-1
- Version: ${PROTOCOL}
- Media: ${MEDIA}

## Money

- Asset: ${ASSET}
- Network: Base (${NETWORK})
- payTo: ${PAY_TO}
- Demo grant (reference only; rejected in production): hp1.demo
- Production grant form: hp1.<BaseTxHash> (verified Base USDC Transfer to payTo)

## Surfaces

- Discovery: /.well-known/harbinger
- Watches: /v1/watches
- Stream (grant-required): /v1/stream
- Hooks (grant-required): /v1/hooks
- Patrol (grant-required): /v1/patrol
- Free tape: /v1/tape
- Edge board: /edge
- Spec: /spec

## Rule

Never invent settlement volume. Never treat demo as money.
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
