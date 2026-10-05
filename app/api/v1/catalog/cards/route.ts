import { H, MEDIA, PROTOCOL, WATCHES, corsHeaders } from "@/lib/protocol";
import { publicCatalog } from "@/lib/catalog";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/** Public card subset. No grant, no key. Same watch set as /v1/watches. */
export async function GET() {
  return new Response(JSON.stringify({ protocol: PROTOCOL, ...publicCatalog(WATCHES) }, null, 2), {
    headers: {
      "content-type": MEDIA,
      [H.version]: PROTOCOL,
      ...corsHeaders(),
      "cache-control": "public, max-age=60",
    },
  });
}
