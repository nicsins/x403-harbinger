import { DEMO_GRANT, H, MEDIA, PROTOCOL, corsHeaders, isValidGrant, mintReceipt, watchById } from "@/lib/protocol";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  return Response.json(
    { protocol: PROTOCOL, rail: "agentmail", live: false, inboxId: "harbinger@agentmail.local" },
    { headers: { [H.version]: PROTOCOL, [H.delivery]: "agentmail", ...corsHeaders() } },
  );
}

export async function POST(request: Request) {
  const grant = request.headers.get(H.grant);
  let body: Record<string, unknown> = {};
  try { body = (await request.json()) as Record<string, unknown>; } catch { body = {}; }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "connect") {
    return Response.json({
      ok: false, live: false, inboxId: "harbinger@agentmail.local",
      note: "Local rail is live. Paste a real AgentMail key on a private edge to provision harbinger@agentmail.to.",
    });
  }
  if (action === "inject") {
    const eightK = Boolean(body.eightK);
    const subject = typeof body.subject === "string" ? body.subject : eightK ? "Form 8-K current report" : "Agent ping";
    return Response.json({
      protocol: PROTOCOL,
      mapped: { event: eightK ? "mail.received.8k" : "mail.received", label: subject },
    });
  }
  if (action === "send") {
    if (!isValidGrant(grant || DEMO_GRANT)) {
      return Response.json({ ok: false, forbidden: "grant-required" }, { status: 403 });
    }
    const watch = watchById(typeof body.watchId === "string" ? body.watchId : null);
    const receipt = mintReceipt(watch.id);
    const event = watch.conditions.map((c) => c.event).join("+");
    return Response.json({ protocol: PROTOCOL, delivery: "agentmail", ping: { watchId: watch.id, receipt, event } });
  }
  return Response.json({ protocol: PROTOCOL, error: "unknown action" }, { status: 400, headers: { "content-type": MEDIA } });
}
