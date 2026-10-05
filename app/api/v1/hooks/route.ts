import { H, MEDIA, PROTOCOL, corsHeaders, findWatch, grantDeniedResponse, watchById } from "@/lib/protocol";
import { checkGrant } from "@/lib/grant";

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
  const watchIdRaw =
    (typeof body.watchId === "string" ? body.watchId : null) ??
    request.headers.get(H.watch);
  const watch = findWatch(watchIdRaw);

  // Register is intake only (no ping delivered), so it binds the tx to the watch
  // and checks TTL/quota but does not consume a use.
  const check = await checkGrant(request.headers.get(H.grant), watchIdRaw, watch, { consume: false });
  if (!check.ok) {
    if (check.status !== 403) return grantDeniedResponse(check, watch ?? watchById(null), watchIdRaw);
    return new Response(JSON.stringify({ forbidden: check.reason }), {
      status: 403,
      headers: { "content-type": MEDIA, [H.forbidden]: check.reason, [H.version]: PROTOCOL, ...corsHeaders() },
    });
  }
  return Response.json(
    { protocol: PROTOCOL, accepted: true, watchId: watch!.id },
    { headers: corsHeaders() },
  );
}
