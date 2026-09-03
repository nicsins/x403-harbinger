export const PROTOCOL = "x403-HARBINGER/1.0";
export const DESIGNATION = "x403-HARBINGER";
export const DOCUMENT = "X403-HP-1";
export const URN = "urn:x403:harbinger:1.0";
export const MEDIA = "application/vnd.x403.harbinger+json";
export const DEMO_GRANT = "hp1.demo";
export const ASSET = "USDC";
export const NETWORK = "eip155:8453";
export const NETWORK_NAME = "base";
export const PAY_TO = "0xDa1Eab46918882f8656a41cF9fCa80e2415369d1";

export const H = {
  version: "X-Harbinger-Version",
  forbidden: "X-Harbinger-Forbidden",
  grant: "X-Harbinger-Grant",
  receipt: "X-Harbinger-Receipt",
  watch: "X-Harbinger-Watch",
  event: "X-Harbinger-Event",
  correlation: "X-Harbinger-Correlation",
  advantage: "X-Harbinger-Advantage-Window",
  crawl: "X-Harbinger-Crawl",
  price: "X-Harbinger-Price",
  delivery: "X-Harbinger-Delivery",
} as const;

export type DeliveryRail = "sse" | "webhook" | "agentmail";

export type Watch = {
  id: string;
  name: string;
  thesis: string;
  logic: "all" | "any";
  windowMs: number;
  advantageMs: number;
  priceUsdc: number;
  billing: "per-ping" | "session";
  conditions: { id: string; event: string; label: string; source: "market" | "agentmail" | "crawl" }[];
  deliveries: DeliveryRail[];
  hot?: boolean;
};

export const WATCHES: Watch[] = [
  {
    id: "w_eth_funding",
    name: "ETH funding spike",
    thesis: "Perp funding prints above 0.08% while spot volume is quiet — lagging books still pricing last hour.",
    logic: "all",
    windowMs: 12_000,
    advantageMs: 840,
    priceUsdc: 0.08,
    billing: "per-ping",
    hot: true,
    deliveries: ["sse", "agentmail"],
    conditions: [
      { id: "c_fund", event: "perp.funding.spike", label: "Funding > 0.08%", source: "market" },
      { id: "c_spot_quiet", event: "spot.volume.quiet", label: "Spot volume lag", source: "market" },
    ],
  },
  {
    id: "w_btc_whale",
    name: "BTC whale + volume",
    thesis: "A known cluster moves > 400 BTC and spot volume confirms within 8s. The join is the edge.",
    logic: "all",
    windowMs: 8_000,
    advantageMs: 620,
    priceUsdc: 0.14,
    billing: "per-ping",
    deliveries: ["sse", "webhook", "agentmail"],
    conditions: [
      { id: "c_whale", event: "chain.whale.btc", label: "Whale transfer", source: "market" },
      { id: "c_vol", event: "spot.volume.spike", label: "Spot volume spike", source: "market" },
    ],
  },
  {
    id: "w_sec_mail",
    name: "8-K in mail AND gap",
    thesis: "An 8-K lands in the agent's inbox and the name gaps. Mail is the source. The book is the confirm.",
    logic: "all",
    windowMs: 90_000,
    advantageMs: 4_200,
    priceUsdc: 0.22,
    billing: "session",
    deliveries: ["sse", "agentmail"],
    conditions: [
      { id: "c_8k", event: "mail.received.8k", label: "8-K via AgentMail", source: "agentmail" },
      { id: "c_gap", event: "spot.gap", label: "Opening gap", source: "market" },
    ],
  },
  {
    id: "w_mail_otp",
    name: "Inbound agent mail",
    thesis: "Any authenticated message into the Harbinger inbox. Used as correlation fuel, billed per ping.",
    logic: "any",
    windowMs: 5_000,
    advantageMs: 180,
    priceUsdc: 0.02,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    conditions: [{ id: "c_mail", event: "mail.received", label: "AgentMail inbound", source: "agentmail" }],
  },
];

export const SERVICES = [
  {
    id: "svc_harbinger",
    name: "Harbinger notify desk",
    host: "this-edge",
    path: "/v1/stream",
    kind: "notify",
    price: "0.02–0.22 USDC",
    crawls24h: 1840,
    note: "Grant-required event stream. 403 until hp1.",
  },
  {
    id: "svc_grokzilla",
    name: "Grokzilla.shop",
    host: "grokzilla.shop",
    path: "/.well-known/harbinger",
    kind: "crawler",
    price: "0.05 USDC / crawl",
    crawls24h: 420,
    note: "Listed crawler target. Pay-per-index.",
  },
  {
    id: "svc_agentmail",
    name: "AgentMail rail",
    host: "agentmail.to",
    path: "/v1/rails/agentmail",
    kind: "rail",
    price: "surcharge 0.01 USDC",
    crawls24h: 96,
    note: "Durable delivery. Sleeping agents still get the ping.",
  },
];

export function watchById(id: string | null | undefined): Watch {
  return WATCHES.find((w) => w.id === id) ?? WATCHES[0]!;
}

export function isValidGrant(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const g = raw.trim();
  return g === DEMO_GRANT || g.startsWith("hp1.");
}

export function mintReceipt(watchId: string): string {
  return `rcpt.${watchId}.${Math.random().toString(16).slice(2, 10)}`;
}

export function corsHeaders() {
  const expose = Object.values(H).join(", ");
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": `${expose}, content-type`,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-expose-headers": expose,
  };
}

export function wellKnown(origin: string) {
  return {
    protocol: PROTOCOL,
    name: "Harbinger",
    designation: DESIGNATION,
    document: DOCUMENT,
    urn: URN,
    status: 403,
    meaning: "Forbidden until grant",
    media_type: MEDIA,
    published: "2026-09-02",
    editors: ["nicsins"],
    asset: ASSET,
    network: NETWORK_NAME,
    chain: NETWORK,
    payTo: PAY_TO,
    discovery: "/.well-known/harbinger",
    index: "/v1/index",
    watches: "/v1/watches",
    notify: {
      sse: "/v1/stream",
      webhook: "/v1/hooks",
      agentmail: {
        rail: "agentmail",
        webhook: "/v1/rails/agentmail",
        note: "Durable copy for sleeping agents. Not the hot path. Not x402.",
      },
    },
    headers: H,
    grant: { scheme: "hp1", demo: DEMO_GRANT, header: H.grant },
    spec: `${origin}/spec`,
    citation:
      'nicsins, "Harbinger: Agent Grant and Notification Protocol", X403-HP-1, x403-HARBINGER/1.0, September 2026.',
  };
}

export function challengeResponse(watch: Watch): Response {
  const event = watch.conditions.map((c) => c.event).join(watch.logic === "all" ? " AND " : " OR ");
  const body = {
    protocol: PROTOCOL,
    document: DOCUMENT,
    urn: URN,
    status: 403,
    forbidden: "grant-required",
    meaning: "Forbidden from this event stream until a Harbinger grant is presented.",
    watch: watch.id,
    event,
    price: `${watch.priceUsdc} ${ASSET}`,
    billing: watch.billing,
    advantageWindow: `${watch.advantageMs}ms`,
    asset: ASSET,
    network: NETWORK,
    payTo: PAY_TO,
    grant: { header: H.grant, scheme: "hp1", demo: DEMO_GRANT },
    delivery: watch.deliveries,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: 403,
    headers: {
      "content-type": MEDIA,
      ...corsHeaders(),
      [H.version]: PROTOCOL,
      [H.forbidden]: "grant-required",
      [H.watch]: watch.id,
      [H.event]: event,
      [H.price]: body.price,
      [H.advantage]: String(watch.advantageMs),
      [H.delivery]: watch.deliveries.join(","),
      "cache-control": "no-store",
    },
  });
}

export function settledPing(watch: Watch) {
  const matched = watch.conditions.map((c) => c.event);
  return {
    protocol: PROTOCOL,
    watchId: watch.id,
    event: matched.join(watch.logic === "all" ? "+" : "|"),
    correlation: 0.99,
    advantageMs: watch.advantageMs,
    priceUsdc: watch.priceUsdc,
    receipt: mintReceipt(watch.id),
    firedAt: new Date().toISOString(),
    conditions: matched,
    delivery: watch.deliveries,
  };
}
