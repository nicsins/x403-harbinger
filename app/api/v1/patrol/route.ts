import { H, MEDIA, PROTOCOL, corsHeaders, gateGrant } from "@/lib/protocol";
import { runPatrol } from "@/lib/patrol";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  // Patrol sweeps the whole book; it keeps its documented default watch for pricing,
  // but the tx grant is still bound to that watch and consumes one use.
  const gate = await gateGrant(request.headers.get(H.grant), request.headers.get(H.watch) ?? "w_btc_10_1h", {
    consume: true,
  });
  if (!gate.ok) return gate.response;
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
