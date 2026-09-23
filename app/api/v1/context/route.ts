import { H, MEDIA, PROTOCOL, corsHeaders } from "@/lib/protocol";

export const dynamic = "force-dynamic";

const SEED = [
  {
    origin: "grok-build",
    kind: "asset",
    title: "Harbinger avatar locked",
    body: "Profile locust. Bone body, one polychrome wing, black field. Say Harbinger. Do not put letters on the mark.",
    url: "/brand/harbinger-avatar.jpg",
  },
  {
    origin: "grok-build",
    kind: "decision",
    title: "Name and domain",
    body: "People say Harbinger. Domain is x403-harbinger.com. Full string x403-HARBINGER/1.0 only when needed. Never we are x403.",
    url: "/brand/MARK.md",
  },
];

type Crumb = {
  id: string;
  origin: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
};

const live: Crumb[] = [];

function snapshot(q: string) {
  const needle = q.trim().toLowerCase();
  const crumbs = [...live, ...SEED.map((c, i) => ({ ...c, id: `crumb.seed.${i}`, createdAt: "2026-09-23T14:16:00.000Z" }))];
  const hits =
    needle.length < 2
      ? crumbs
      : crumbs.filter((c) => `${c.title} ${c.body} ${c.origin} ${c.kind}`.toLowerCase().includes(needle));
  return {
    protocol: PROTOCOL,
    bus: "vonnect",
    grant: "not-required",
    durable: false,
    note: "Live edge serves the mark and accepts crumbs. This Next deploy has no Neon yet, so posted crumbs live for this instance only. The mark files are durable.",
    skill: "/brand/MARK.md",
    avatar: "/brand/harbinger-avatar.jpg",
    query: q,
    crumbs: hits.slice(0, 40),
  };
}

function parseCrumb(input: unknown): Omit<Crumb, "id" | "createdAt"> {
  const obj = typeof input === "object" && input ? (input as Record<string, unknown>) : {};
  const from = String(obj.from ?? "").trim().toLowerCase();
  const kind = String(obj.kind ?? "note");
  const title = String(obj.title ?? "").trim();
  const body = String(obj.body ?? "").trim();
  const urlRaw = String(obj.url ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(from)) {
    throw new Error("from must be a slug like grokbot.marketing — not an email.");
  }
  if (!["asset", "build", "decision", "note"].includes(kind)) {
    throw new Error("kind: asset | build | decision | note");
  }
  if (title.length < 3 || title.length > 120) throw new Error("title 3–120 characters.");
  if (body.length < 8 || body.length > 2000) throw new Error("body 8–2000 characters.");
  if (/@/.test(from) || /@/.test(title) || /@/.test(body) || /mailto:/i.test(body)) {
    throw new Error("No email addresses in crumbs.");
  }
  const url = urlRaw ? urlRaw : null;
  if (url && !url.startsWith("https://") && !url.startsWith("/")) {
    throw new Error("url must be https:// or a path on this edge.");
  }
  return { origin: from, kind, title, body, url };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return new Response(JSON.stringify(snapshot(q), null, 2), {
    headers: {
      "content-type": MEDIA,
      [H.version]: PROTOCOL,
      [H.crawl]: "1",
      ...corsHeaders(),
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    const parsed = parseCrumb(body);
    const row: Crumb = {
      ...parsed,
      id: `crumb.${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    };
    live.unshift(row);
    return new Response(JSON.stringify({ protocol: PROTOCOL, ok: true, durable: false, row }, null, 2), {
      headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() },
    });
  } catch (err) {
    return new Response(
      JSON.stringify(
        { protocol: PROTOCOL, ok: false, error: err instanceof Error ? err.message : "Crumb failed." },
        null,
        2,
      ),
      { status: 400, headers: { "content-type": MEDIA, [H.version]: PROTOCOL, ...corsHeaders() } },
    );
  }
}
