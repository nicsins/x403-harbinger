import { MEDIA, PROTOCOL, H, corsHeaders } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(
    JSON.stringify(
      {
        alias: true,
        canonical: `${origin}/.well-known/harbinger`,
        protocol: PROTOCOL,
        note: "This alias exists so crawlers that still look for x403.json find Harbinger.",
      },
      null,
      2,
    ),
    {
      headers: {
        "content-type": MEDIA,
        [H.version]: PROTOCOL,
        Link: `<${origin}/.well-known/harbinger>; rel="canonical"`,
        ...corsHeaders(),
      },
    },
  );
}
