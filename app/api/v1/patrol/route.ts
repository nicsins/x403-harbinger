import { H, MEDIA, PROTOCOL, corsHeaders, gateGrant, grantReservedResponse } from "@/lib/protocol";
import { runPatrol } from "@/lib/patrol";
import { lookupPendingMonitor, monitorNow, settleOverdueHold } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  // Patrol sweeps the whole book; it keeps its documented default watch for pricing,
  // but the tx grant is still bound to that watch and consumes one use.
  const watchId = request.headers.get(H.watch) ?? "w_btc_10_1h";
  let gate = await gateGrant(request.headers.get(H.grant), watchId, {
    consume: true,
  });
  if (!gate.ok && gate.check.reason === "grant-reserved" && gate.check.txHash && gate.check.binding) {
    // A hold past its deadline is settled (no-move releases it), then the spend is retried once.
    const hold = await settleOverdueHold(gate.check.txHash, gate.check.binding.watchId, monitorNow());
    if (hold.settled) gate = await gateGrant(request.headers.get(H.grant), watchId, { consume: true });
  }
  if (!gate.ok) {
    if (gate.check.reason === "grant-reserved" && gate.check.binding) {
      const held = gate.check.txHash ? await lookupPendingMonitor(gate.check.txHash, gate.check.binding.watchId) : null;
      return grantReservedResponse({
        watchId: gate.check.binding.watchId,
        reserved: gate.check.binding.reserved ?? 0,
        used: gate.check.binding.used,
        quota: gate.check.binding.quota,
        ...(held ? { monitorId: held.id, deadlineAt: new Date(held.deadlineAt).toISOString() } : {}),
      });
    }
    return gate.response;
  }
  const snap = await runPatrol(true);
  return new Response(
    JSON.stringify(
      {
        protocol: PROTOCOL,
        fired: snap.firedCount,
        live: snap.liveCount,
        ranAt: snap.ranAt,
        note: snap.note,
        notables: snap.notables,
        pairs: snap.pairs,
        tape: snap.tape,
        watches: snap.watches.map((w) => ({
          id: w.id,
          name: w.name,
          fired: w.fired,
          score: w.score,
          event: w.event,
          legs: w.legs,
        })),
      },
      null,
      2,
    ),
    {
      headers: {
        "content-type": MEDIA,
        [H.version]: PROTOCOL,
        [H.receipt]: `patrol.${Date.now()}`,
        ...corsHeaders(),
      },
    },
  );
}
