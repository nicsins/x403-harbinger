import { H, MEDIA, PROTOCOL, corsHeaders, findWatch, grantDeniedResponse, grantReservedResponse, mintReceipt, watchById } from "@/lib/protocol";
import { checkGrant } from "@/lib/grant";
import { lookupPendingMonitor, monitorNow, settleOverdueHold } from "@/lib/monitor";

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
    const watchIdRaw = typeof body.watchId === "string" ? body.watchId : null;
    const found = findWatch(watchIdRaw);
    let check = await checkGrant(grant, watchIdRaw, found, { consume: true });
    if (!check.ok && check.reason === "grant-reserved" && check.txHash && check.binding) {
      // A hold past its deadline is settled (no-move releases it), then the spend is retried once.
      const hold = await settleOverdueHold(check.txHash, check.binding.watchId, monitorNow());
      if (hold.settled) check = await checkGrant(grant, watchIdRaw, found, { consume: true });
    }
    if (!check.ok) {
      if (check.reason === "grant-reserved" && check.binding) {
        const held = check.txHash ? await lookupPendingMonitor(check.txHash, check.binding.watchId) : null;
        return grantReservedResponse({
          watchId: check.binding.watchId,
          reserved: check.binding.reserved ?? 0,
          used: check.binding.used,
          quota: check.binding.quota,
          ...(held ? { monitorId: held.id, deadlineAt: new Date(held.deadlineAt).toISOString() } : {}),
        });
      }
      if (check.status !== 403) return grantDeniedResponse(check, found ?? watchById(null), watchIdRaw);
      return Response.json({ ok: false, forbidden: check.reason }, { status: 403 });
    }
    const watch = found!;
    const txRef = check.kind === "tx" ? check.txHash : null;
    const receipt = mintReceipt(watch.id, txRef);
    const event = watch.conditions.map((c) => c.event).join("+");
    return Response.json({ protocol: PROTOCOL, delivery: "agentmail", ping: { watchId: watch.id, receipt, event } });
  }
  return Response.json({ protocol: PROTOCOL, error: "unknown action" }, { status: 400, headers: { "content-type": MEDIA } });
}
