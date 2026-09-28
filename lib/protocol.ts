import { WATCH_BOOK } from "@/lib/agency";

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
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const TRANSFER_TOPIC0 = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const MIN_GRANT_USDC = 0.02;

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

export const MAIL_WATCHES: Watch[] = [
  {
    id: "w_eth_funding",
    name: "ETH funding spike",
    thesis: "Perp funding prints above 0.08% while spot volume is quiet - lagging books still pricing last hour.",
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
    thesis: "An 8-K lands in the agent inbox and the name gaps. Mail is the source. The book is the confirm.",
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
