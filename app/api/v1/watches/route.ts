import { H, MEDIA, PROTOCOL, WATCHES, corsHeaders, challengeResponse, isValidGrant, watchById } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  if (request.headers.get(H.crawl) === "1" && !isValidGrant(request.headers.get(H.grant))) {
    return challengeResponse(watchById(null));
  }
  return new Response(JSON.stringify({ protocol: PROTOCOL, watches: WATCHES }, null, 2), {
    headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() },
  });
}
