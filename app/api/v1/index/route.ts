import { H, MEDIA, PROTOCOL, corsHeaders, challengeResponse, isValidGrant, paidNotifyLive, publicServices, watchById } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  // While paid notify is paused, no payment challenge for the stream watch.
  if (paidNotifyLive() && request.headers.get(H.crawl) === "1" && !(await isValidGrant(request.headers.get(H.grant)))) {
    return challengeResponse(watchById(null));
  }
  return new Response(JSON.stringify({ protocol: PROTOCOL, services: publicServices() }, null, 2), {
    headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() },
  });
}
