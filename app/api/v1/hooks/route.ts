import { H, MEDIA, MIN_GRANT_USDC, PROTOCOL, corsHeaders, isValidGrant, watchById } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const watchId =
    (typeof body.watchId === "string" ? body.watchId : null) ??
    request.headers.get(H.watch);
  const watch = watchId ? watchById(watchId) : null;
  const minUsdc = watch?.priceUsdc ?? MIN_GRANT_USDC;

  if (!(await isValidGrant(request.headers.get(H.grant), { minUsdc }))) {
    return new Response(JSON.stringify({ forbidden: "grant-required" }), {
      status: 403,
      headers: { "content-type": MEDIA, [H.forbidden]: "grant-required", [H.version]: PROTOCOL, ...corsHeaders() },
    });
  }
  return Response.json({ protocol: PROTOCOL, accepted: true }, { headers: corsHeaders() });
}
