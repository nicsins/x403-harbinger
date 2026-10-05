import { validateCallbackUrl } from "@/lib/hook";
import { monitorNow, registerHook } from "@/lib/monitor";
import { H, MEDIA, PROTOCOL, corsHeaders, findWatch, grantDeniedResponse, notPingableResponse, paidPingEligible, watchById } from "@/lib/protocol";
import { checkGrant } from "@/lib/grant";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function callbackRaw(body: Record<string, unknown>): unknown {
  for (const key of ["callback", "url", "webhook"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
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
  // Watches whose card has no webhook rail never take a hook. Refuse before any
  // grant check, so nothing is bound or consumed.
  if (watch && !watch.deliveries.includes("webhook")) {
    return new Response(
      JSON.stringify({
        protocol: PROTOCOL,
        status: 400,
        error: "hook-not-supported-for-watch",
        meaning: "This watch has no webhook delivery. See deliveries on /v1/catalog/cards.",
        watch: watch.id,
        deliveries: watch.deliveries,
      }),
      { status: 400, headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() } },
    );
  }
  if (watch && !paidPingEligible(watch)) return notPingableResponse(watch);
  const rawCallback = callbackRaw(body);
  const parsed = rawCallback == null ? null : validateCallbackUrl(rawCallback);
  const now = monitorNow();

  // Registration binds the grant and does not spend. Arming a callback reserves
  // one unit; the pump converts it only when a later sample actually fires.
  const check = await checkGrant(request.headers.get(H.grant), watchIdRaw, watch, { consume: false, now });
  if (!check.ok) {
    if (check.status !== 403) return grantDeniedResponse(check, watch ?? watchById(null), watchIdRaw);
    return new Response(JSON.stringify({ forbidden: check.reason }), {
      status: 403,
      headers: { "content-type": MEDIA, [H.forbidden]: check.reason, [H.version]: PROTOCOL, ...corsHeaders() },
    });
  }
  if (parsed && !parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.reason }), {
      status: 400,
      headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() },
    });
  }
  if (check.kind === "tx" && check.binding.used >= check.binding.quota) {
    return new Response(JSON.stringify({ forbidden: "grant-exhausted" }), {
      status: 403,
      headers: { "content-type": MEDIA, [H.forbidden]: "grant-exhausted", [H.version]: PROTOCOL, ...corsHeaders() },
    });
  }

  const headers: Record<string, string> = { ...corsHeaders() };
  if (parsed?.ok) {
    const armed = await registerHook({
      watch: watch!,
      check,
      grantRaw: (request.headers.get(H.grant) ?? "").trim(),
      url: parsed.url,
      now,
    });
    if (!armed.ok) return armed.denied.response;
    if (armed.monitorId) headers["X-Harbinger-Monitor"] = armed.monitorId;
  }

  return Response.json({ protocol: PROTOCOL, accepted: true, watchId: watch!.id }, { headers });
}
