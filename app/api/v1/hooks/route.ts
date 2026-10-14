import { corsHeaders } from "@/lib/protocol";
import { handleHookGet, handleHookPost } from "@/lib/notify-run";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  return handleHookGet(request);
}

export async function POST(request: Request) {
  return handleHookPost(request);
}
