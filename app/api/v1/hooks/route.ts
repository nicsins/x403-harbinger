import { H, MEDIA, PROTOCOL, corsHeaders, isValidGrant } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  if (!isValidGrant(request.headers.get(H.grant))) {
    return new Response(JSON.stringify({ forbidden: "grant-required" }), {
      status: 403,
      headers: { "content-type": MEDIA, [H.forbidden]: "grant-required", [H.version]: PROTOCOL, ...corsHeaders() },
    });
  }
  return Response.json({ protocol: PROTOCOL, accepted: true }, { headers: corsHeaders() });
}
