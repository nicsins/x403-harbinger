/** Public free desk. Last prints are free. Joins still 403 until hp1. */

export type HotCoin = {
  id: string;
  symbol: string;
  name: string;
};

export const HOT_COINS: HotCoin[] = [
  { id: "hype", symbol: "HYPE-USD", name: "Hyperliquid" },
  { id: "tao", symbol: "TAO-USD", name: "Bittensor" },
  { id: "sui", symbol: "SUI-USD", name: "Sui" },
  { id: "sei", symbol: "SEI-USD", name: "Sei" },
  { id: "apt", symbol: "APT-USD", name: "Aptos" },
  { id: "near", symbol: "NEAR-USD", name: "NEAR" },
  { id: "fet", symbol: "FET-USD", name: "Artificial Superintelligence" },
  { id: "rndr", symbol: "RENDER-USD", name: "Render" },
  { id: "ondo", symbol: "ONDO-USD", name: "Ondo" },
  { id: "jup", symbol: "JUP-USD", name: "Jupiter" },
  { id: "hbar", symbol: "HBAR-USD", name: "Hedera" },
  { id: "pepe", symbol: "PEPE-USD", name: "Pepe" },
  { id: "wif", symbol: "WIF-USD", name: "dogwifhat" },
  { id: "bonk", symbol: "BONK-USD", name: "Bonk" },
];

export type XName = {
  id: string;
  name: string;
  listed: boolean;
  symbol?: string;
  mark?: string;
  source?: string;
  note: string;
};

export const X_DESK: XName[] = [
  {
    id: "tsla",
    name: "Tesla",
    listed: true,
    symbol: "TSLA",
    note: "Public. The liquid Musk print. Live hour bars.",
  },
  {
    id: "rklb",
    name: "Rocket Lab",
    listed: true,
    symbol: "RKLB",
    note: "Public space tape. Not SpaceX. A listed proxy, not a substitute.",
  },
  {
    id: "spacex",
    name: "SpaceX",
    listed: false,
    mark: "$1.25T combined (Feb 2026, xAI merger)",
    source: "CNBC / Reuters",
    note: "Private. IPO track reported. Not a live quote — last reported mark only.",
  },
  {
    id: "xai",
    name: "xAI",
    listed: false,
    mark: "$230B last standalone (Jan 2026 Series E); folded into SpaceX",
    source: "CNBC",
    note: "Private. Grok trains here. Not a live quote.",
  },
  {
    id: "xcorp",
    name: "X",
    listed: false,
    mark: "Acquired by xAI in 2025 (~$33B reported)",
    source: "CNBC",
    note: "Private. Not a live quote. News is the print.",
  },
];

export const VIDEO_FEEDS = [
  {
    id: "bloomberg",
    title: "Bloomberg Television",
    channel: "UCIALMKvObZNtJ6AmdCLP7Lg",
    note: "Markets, 24h. Live when the channel is on.",
  },
  {
    id: "sky",
    title: "Sky News",
    channel: "UCoMdktPbSTixShs3mvgTg-A",
    note: "Breaking. Live when the channel is on.",
  },
];

export const NETWORK_EDGES = [
  {
    id: "harbinger",
    name: "Harbinger agency",
    host: "www.x403-harbinger.com",
    href: "/agency",
    kind: "protocol",
    note: "Grant-required joins. This edge.",
  },
  {
    id: "grokzilla",
    name: "Grokzilla.shop",
    host: "grokzilla.shop",
    href: "https://grokzilla.shop",
    kind: "shop",
    note: "Listed crawler target. Microservices and pay-per-index.",
  },
  {
    id: "dnp",
    name: "Dragon and Panda",
    host: "dragonandpanda.life",
    href: "https://dragonandpanda.life",
    kind: "network",
    note: "Creative network. High-vibe ops, kids shorts, the other shop window.",
  },
];

export const FREE_PINGS = [
  {
    id: "free_hot_coin",
    name: "Hottest coin on the hour",
    thesis: "Largest absolute 1h move among the hot-coin desk. Last print is free. The join is not.",
    event: "desk.hotcoin.leader.1h",
  },
  {
    id: "free_fx_leader",
    name: "Biggest G10 print today",
    thesis: "Largest absolute 1d move on the G10 book. A public wake-up, not a grant.",
    event: "desk.fx.leader.1d",
  },
  {
    id: "free_tsla",
    name: "Tesla last print",
    thesis: "Tesla hour and day. The listed X-desk name. SpaceX and xAI stay marks, not quotes.",
    event: "desk.tsla.print",
  },
];

export type Brief = {
  title: string;
  href: string;
  source: string;
  published: string | null;
};

export type DeskPrint = {
  id: string;
  name: string;
  symbol: string;
  klass: "crypto" | "forex" | "equity";
  last: number | null;
  pct1h: number | null;
  pct1d: number | null;
  ok: boolean;
  desk: "hot" | "fx" | "x";
};

export type FreePing = {
  id: string;
  name: string;
  thesis: string;
  event: string;
  label: string;
  pct: number | null;
  symbol: string | null;
};

export type DeskSnapshot = {
  ranAt: string;
  note: string;
  hot: DeskPrint[];
  fx: DeskPrint[];
  xListed: DeskPrint[];
  xPrivate: XName[];
  movers: DeskPrint[];
  freePings: FreePing[];
  briefs: Brief[];
  videos: typeof VIDEO_FEEDS;
  network: typeof NETWORK_EDGES;
};
