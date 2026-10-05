import { timingSafeEqual } from "node:crypto";
import { monitorNow, runPump } from "@/lib/monitor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const got = Buffer.from(header);
  const want = Buffer.from(expected);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/** Scheduled evaluator. Vercel Cron should call this with Authorization: Bearer $CRON_SECRET. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ forbidden: "pump-unauthorized" }, { status: 401 });
  }
  try {
    const report = await runPump(monitorNow());
    return Response.json(report, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "pump-failed" }, { status: 503 });
  }
}
