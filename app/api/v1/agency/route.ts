import { H, MEDIA, PROTOCOL, corsHeaders } from "@/lib/protocol";
import { catalogBody } from "@/lib/patrol";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const body = catalogBody();
  return new Response(
    JSON.stringify(
      {
        protocol: PROTOCOL,
        catalog: "agency",
        ...body,
        note: "Discovery is public. POST /v1/patrol with a grant to run a live sweep. Not investment advice.",
      },
      null,
      2,
    ),
    { headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() } },
  );
}
