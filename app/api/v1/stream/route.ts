import { formatCorrelation, monitorNow, pollStream } from "@/lib/monitor";
import { H, MEDIA, PROTOCOL, corsHeaders, findWatch, gateGrant, notPingableResponse, paidPingEligible } from "@/lib/protocol";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const watchIdRaw = request.headers.get(H.watch) ?? url.searchParams.get("watch");
  const named = findWatch(watchIdRaw);
  if (named && !paidPingEligible(named)) return notPingableResponse(named);
  const now = monitorNow();
  const gate = await gateGrant(request.headers.get(H.grant), watchIdRaw, { consume: false, now });
  if (!gate.ok) return gate.response;

  const rearm = request.headers.get("X-Harbinger-Rearm") === "1" || url.searchParams.get("rearm") === "1";
  let outcome;
  try {
    outcome = await pollStream({
      watch: gate.watch,
      check: gate.check,
      grantRaw: (request.headers.get(H.grant) ?? "").trim(),
      rearm,
      now,
    });
  } catch {
    return new Response(
      JSON.stringify({
        protocol: PROTOCOL,
        status: 503,
        error: "grant-store-unavailable",
        meaning: "Grant binding store unavailable; refusing to accept tx grants without replay protection.",
      }),
      { status: 503, headers: { "content-type": MEDIA, ...corsHeaders(), [H.version]: PROTOCOL, "cache-control": "no-store" } },
    );
  }
  if (outcome.http !== 200) return outcome.response;

  const body = outcome.body;
  const headers: Record<string, string> = {
    ...corsHeaders(),
    [H.version]: PROTOCOL,
    [H.watch]: gate.watch.id,
    [H.correlation]: formatCorrelation(outcome.correlation),
    [H.advantage]: String(gate.watch.advantageMs),
    [H.price]: `${gate.watch.priceUsdc} USDC`,
    [H.delivery]: gate.watch.deliveries.join(","),
    "cache-control": "no-store",
  };
  if (outcome.receipt) headers[H.receipt] = outcome.receipt;
  if (request.headers.get(H.crawl) === "1") headers[H.crawl] = "1";

  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    const event = body.status === "fired" ? "ping" : body.status === "no-move" ? "no-move" : "pending";
    return new Response(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`, {
      status: 200,
      headers: { ...headers, "content-type": "text/event-stream; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { ...headers, "content-type": MEDIA },
  });
}
