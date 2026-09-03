import { H, MEDIA, PROTOCOL, corsHeaders, challengeResponse, isValidGrant, settledPing, watchById } from "@/lib/protocol";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const watch = watchById(request.headers.get(H.watch) ?? url.searchParams.get("watch"));
  const grant = request.headers.get(H.grant);
  if (!isValidGrant(grant)) return challengeResponse(watch);

  const ping = settledPing(watch);
  const headers: Record<string, string> = {
    ...corsHeaders(),
    [H.version]: PROTOCOL,
    [H.receipt]: ping.receipt,
    [H.watch]: watch.id,
    [H.correlation]: ping.correlation.toFixed(2),
    [H.advantage]: String(watch.advantageMs),
    [H.price]: `${watch.priceUsdc} USDC`,
    [H.delivery]: ping.delivery.join(","),
    "cache-control": "no-store",
  };
  if (request.headers.get(H.crawl) === "1") headers[H.crawl] = "1";
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return new Response(`event: ping\ndata: ${JSON.stringify(ping)}\n\n`, {
      status: 200,
      headers: { ...headers, "content-type": "text/event-stream; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify(ping, null, 2), {
    status: 200,
    headers: { ...headers, "content-type": MEDIA },
  });
}
