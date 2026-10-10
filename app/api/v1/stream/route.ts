import { corsHeaders } from "@/lib/protocol";
import { handleStream } from "@/lib/notify-run";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  return handleStream(request);
}
