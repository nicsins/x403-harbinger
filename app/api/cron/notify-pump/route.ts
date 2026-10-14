import { handlePump } from "@/lib/notify-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handlePump(request);
}

export async function POST(request: Request) {
  return handlePump(request);
}
