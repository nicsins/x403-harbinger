import { H, MEDIA, PROTOCOL, corsHeaders } from "@/lib/protocol";
import { performDesk, tapeBody } from "@/lib/desk-run";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const snap = await performDesk(false);
  return new Response(JSON.stringify(tapeBody(snap), null, 2), {
    headers: {
      "content-type": MEDIA,
      [H.version]: PROTOCOL,
      [H.crawl]: "1",
      ...corsHeaders(),
      "cache-control": "public, max-age=30, s-maxage=60",
    },
  });
}

export async function POST() {
  const snap = await performDesk(true);
  return new Response(JSON.stringify(tapeBody(snap), null, 2), {
    headers: {
      "content-type": MEDIA,
      [H.version]: PROTOCOL,
      [H.crawl]: "1",
      ...corsHeaders(),
      "cache-control": "no-store",
    },
  });
}
