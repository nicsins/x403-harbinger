import { MEDIA, PROTOCOL, H, wellKnown, corsHeaders } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(wellKnown(origin), null, 2), {
    headers: {
      "content-type": MEDIA,
      [H.version]: PROTOCOL,
      ...corsHeaders(),
      "cache-control": "public, max-age=60",
    },
  });
}
