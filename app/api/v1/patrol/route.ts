import { H, MEDIA, PROTOCOL, challengeResponse, corsHeaders, isValidGrant, watchById } from "@/lib/protocol";
import { runPatrol } from "@/lib/patrol";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  if (!isValidGrant(request.headers.get(H.grant))) {
    return challengeResponse(watchById("w_btc_10_1h"));
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
