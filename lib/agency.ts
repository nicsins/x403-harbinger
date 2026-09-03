/** Harbinger agency catalog. Finance first; other lanes are reserved horizons. */

export type Lane = "finance" | "news" | "elections" | "ads" | "sentiment";
export type Klass = "crypto" | "forex" | "equity";
export type Direction = "up" | "down" | "abs";
export type AgentRole = "scout" | "joiner" | "archivist" | "herald" | "horizon";

export type Instrument = {
  id: string;
  klass: Klass;
  symbol: string;
  name: string;
  venue: string;
  quote: string;
  lane: Lane;
};

export type SwarmAgent = {
  id: string;
  role: AgentRole;
  beat: string;
};

export type WatchLeg = {
  id: string;
  watchId: string;
  instrumentId: string;
  event: string;
  label: string;
  direction: Direction;
  thresholdPct: number;
  windowMinutes: number;
};

export type WatchDef = {
  id: string;
  name: string;
  thesis: string;
  logic: "all" | "any";
  windowMinutes: number;
  advantageMs: number;
  priceUsdc: number;
  billing: "per-ping" | "session";
  deliveries: Array<"sse" | "webhook" | "agentmail">;
  lane: Lane;
  hot?: boolean;
  legs: WatchLeg[];
};

export const INSTRUMENTS: Instrument[] = [
  { id: "btc", klass: "crypto", symbol: "BTC-USD", name: "Bitcoin", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "eth", klass: "crypto", symbol: "ETH-USD", name: "Ethereum", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "sol", klass: "crypto", symbol: "SOL-USD", name: "Solana", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "bnb", klass: "crypto", symbol: "BNB-USD", name: "BNB", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "xrp", klass: "crypto", symbol: "XRP-USD", name: "XRP", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "doge", klass: "crypto", symbol: "DOGE-USD", name: "Dogecoin", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "avax", klass: "crypto", symbol: "AVAX-USD", name: "Avalanche", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "link", klass: "crypto", symbol: "LINK-USD", name: "Chainlink", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "ada", klass: "crypto", symbol: "ADA-USD", name: "Cardano", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "ton", klass: "crypto", symbol: "TON-USD", name: "Toncoin", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "eurusd", klass: "forex", symbol: "EURUSD=X", name: "EUR/USD", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "gbpusd", klass: "forex", symbol: "GBPUSD=X", name: "GBP/USD", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "usdjpy", klass: "forex", symbol: "USDJPY=X", name: "USD/JPY", venue: "Yahoo", quote: "JPY", lane: "finance" },
  { id: "usdchf", klass: "forex", symbol: "USDCHF=X", name: "USD/CHF", venue: "Yahoo", quote: "CHF", lane: "finance" },
  { id: "audusd", klass: "forex", symbol: "AUDUSD=X", name: "AUD/USD", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "usdcad", klass: "forex", symbol: "USDCAD=X", name: "USD/CAD", venue: "Yahoo", quote: "CAD", lane: "finance" },
  { id: "eurjpy", klass: "forex", symbol: "EURJPY=X", name: "EUR/JPY", venue: "Yahoo", quote: "JPY", lane: "finance" },
  { id: "eurgbp", klass: "forex", symbol: "EURGBP=X", name: "EUR/GBP", venue: "Yahoo", quote: "GBP", lane: "finance" },
  { id: "spy", klass: "equity", symbol: "SPY", name: "S&P 500 ETF", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "qqq", klass: "equity", symbol: "QQQ", name: "Nasdaq 100 ETF", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "iwm", klass: "equity", symbol: "IWM", name: "Russell 2000 ETF", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "nvda", klass: "equity", symbol: "NVDA", name: "NVIDIA", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "aapl", klass: "equity", symbol: "AAPL", name: "Apple", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "msft", klass: "equity", symbol: "MSFT", name: "Microsoft", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "tsla", klass: "equity", symbol: "TSLA", name: "Tesla", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "gld", klass: "equity", symbol: "GLD", name: "Gold ETF", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "tlt", klass: "equity", symbol: "TLT", name: "20Y Treasury ETF", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "uso", klass: "equity", symbol: "USO", name: "Oil ETF", venue: "Yahoo", quote: "USD", lane: "finance" },
  { id: "vix", klass: "equity", symbol: "^VIX", name: "VIX", venue: "Yahoo", quote: "USD", lane: "finance" },
];

export const SWARM: SwarmAgent[] = [
  { id: "scout.crypto", role: "scout", beat: "crypto: btc eth sol bnb xrp doge avax link ada ton" },
  { id: "scout.fx", role: "scout", beat: "forex: eurusd gbpusd usdjpy usdchf audusd usdcad eurjpy eurgbp" },
  { id: "scout.equity", role: "scout", beat: "equity: spy qqq iwm nvda aapl msft tsla gld tlt uso vix" },
  { id: "joiner.correlation", role: "joiner", beat: "AND/OR over watch legs inside the window" },
  { id: "archivist.history", role: "archivist", beat: "7-day hit rate from the same bars" },
  { id: "herald.notify", role: "herald", beat: "403 until hp1 · /v1/stream" },
  { id: "horizon.news", role: "horizon", beat: "world events / headlines — reserved" },
  { id: "horizon.elections", role: "horizon", beat: "elections / polling — reserved" },
  { id: "horizon.ads", role: "horizon", beat: "advertising spend / attention — reserved" },
  { id: "horizon.sentiment", role: "horizon", beat: "crowd tone — reserved" },
];

function leg(
  watchId: string,
  instrumentId: string,
  thresholdPct: number,
  windowMinutes: number,
  direction: Direction,
  label: string,
): WatchLeg {
  const dir = direction === "abs" ? "move" : direction === "up" ? "up" : "down";
  const event = `${instrumentId}.${dir}.${thresholdPct}pct.${windowMinutes}m`;
  return {
    id: `leg_${watchId}_${instrumentId}_${windowMinutes}`,
    watchId,
    instrumentId,
    event,
    label,
    direction,
    thresholdPct,
    windowMinutes,
  };
}

export const WATCH_BOOK: WatchDef[] = [
  {
    id: "w_btc_10_1h",
    name: "BTC 10% in one hour",
    thesis: "Spot bitcoin prints a 10% hour. Historically rare. Lagging books and perps still quoting the last regime.",
    logic: "any",
    windowMinutes: 60,
    advantageMs: 2400,
    priceUsdc: 0.22,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    hot: true,
    legs: [leg("w_btc_10_1h", "btc", 10, 60, "abs", "BTC ±10% / 1h")],
  },
  {
    id: "w_btc_5_1h",
    name: "BTC 5% in one hour",
    thesis: "A 5% bitcoin hour is the more common wake-up. Same window as the 10% print, lower bar, still rare on a 7-day tape.",
    logic: "any",
    windowMinutes: 60,
    advantageMs: 1800,
    priceUsdc: 0.09,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [leg("w_btc_5_1h", "btc", 5, 60, "abs", "BTC ±5% / 1h")],
  },
  {
    id: "w_eth_10_1h",
    name: "ETH 10% in one hour",
    thesis: "Ether matching the bitcoin 10% hour. Same scope, different book. The join with BTC is a separate watch.",
    logic: "any",
    windowMinutes: 60,
    advantageMs: 2000,
    priceUsdc: 0.18,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [leg("w_eth_10_1h", "eth", 10, 60, "abs", "ETH ±10% / 1h")],
  },
  {
    id: "w_eth_btc_join",
    name: "ETH and BTC hour join",
    thesis: "ETH and BTC both move 5%+ in the same hour. The join is the edge — one print is noise.",
    logic: "all",
    windowMinutes: 60,
    advantageMs: 1800,
    priceUsdc: 0.16,
    billing: "per-ping",
    deliveries: ["sse", "webhook", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_eth_btc_join", "eth", 5, 60, "abs", "ETH ±5% / 1h"),
      leg("w_eth_btc_join", "btc", 5, 60, "abs", "BTC ±5% / 1h"),
    ],
  },
  {
    id: "w_sol_12_1h",
    name: "SOL 12% hour",
    thesis: "Solana's hour bars gap harder than majors. A 12% print is a wake-up for beta books.",
    logic: "any",
    windowMinutes: 60,
    advantageMs: 1600,
    priceUsdc: 0.12,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [leg("w_sol_12_1h", "sol", 12, 60, "abs", "SOL ±12% / 1h")],
  },
  {
    id: "w_eth_8_4h",
    name: "ETH 8% in four hours",
    thesis: "Four-hour ether expansion. Session traders still fading the first hour.",
    logic: "any",
    windowMinutes: 240,
    advantageMs: 3200,
    priceUsdc: 0.1,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [leg("w_eth_8_4h", "eth", 8, 240, "abs", "ETH ±8% / 4h")],
  },
  {
    id: "w_fx_dollar_bid",
    name: "Dollar bid: EUR down, JPY up",
    thesis: "EUR/USD sells 0.4% on the day while USD/JPY lifts 0.4%. Dollar bid, not a single pair glitch.",
    logic: "all",
    windowMinutes: 1440,
    advantageMs: 5400,
    priceUsdc: 0.11,
    billing: "session",
    deliveries: ["sse", "webhook", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_fx_dollar_bid", "eurusd", 0.4, 1440, "down", "EURUSD ≤ −0.4% / 1d"),
      leg("w_fx_dollar_bid", "usdjpy", 0.4, 1440, "up", "USDJPY ≥ +0.4% / 1d"),
    ],
  },
  {
    id: "w_cable_euro",
    name: "Cable and euro four-hour join",
    thesis: "GBP/USD and EUR/USD both move 0.35% in four hours. G10 risk, not one-pair flow.",
    logic: "all",
    windowMinutes: 240,
    advantageMs: 2800,
    priceUsdc: 0.09,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_cable_euro", "gbpusd", 0.35, 240, "abs", "GBPUSD ±0.35% / 4h"),
      leg("w_cable_euro", "eurusd", 0.35, 240, "abs", "EURUSD ±0.35% / 4h"),
    ],
  },
  {
    id: "w_risk_off",
    name: "Risk-off: BTC dump and SPY red",
    thesis: "Bitcoin −5% on the four-hour and SPY −1.5% on the day. Cross-asset de-risk, not a crypto-only wick.",
    logic: "all",
    windowMinutes: 1440,
    advantageMs: 4200,
    priceUsdc: 0.2,
    billing: "per-ping",
    deliveries: ["sse", "webhook", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_risk_off", "btc", 5, 240, "down", "BTC ≤ −5% / 4h"),
      leg("w_risk_off", "spy", 1.5, 1440, "down", "SPY ≤ −1.5% / 1d"),
    ],
  },
  {
    id: "w_nvda_qqq",
    name: "NVDA and QQQ day join",
    thesis: "NVIDIA ±5% on the day while QQQ confirms ±2%. Single-name is not the product. The join is.",
    logic: "all",
    windowMinutes: 1440,
    advantageMs: 3600,
    priceUsdc: 0.14,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_nvda_qqq", "nvda", 5, 1440, "abs", "NVDA ±5% / 1d"),
      leg("w_nvda_qqq", "qqq", 2, 1440, "abs", "QQQ ±2% / 1d"),
    ],
  },
  {
    id: "w_gold_yen",
    name: "Gold up, dollar-yen down",
    thesis: "GLD +1.2% on the day and USD/JPY −0.4%. Haven bid with a weaker dollar.",
    logic: "all",
    windowMinutes: 1440,
    advantageMs: 4000,
    priceUsdc: 0.13,
    billing: "session",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_gold_yen", "gld", 1.2, 1440, "up", "GLD ≥ +1.2% / 1d"),
      leg("w_gold_yen", "usdjpy", 0.4, 1440, "down", "USDJPY ≤ −0.4% / 1d"),
    ],
  },
  {
    id: "w_tsla_8_1d",
    name: "TSLA 8% session",
    thesis: "Tesla ±8% on the day. High-beta tape that still wakes momentum desks.",
    logic: "any",
    windowMinutes: 1440,
    advantageMs: 2200,
    priceUsdc: 0.08,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [leg("w_tsla_8_1d", "tsla", 8, 1440, "abs", "TSLA ±8% / 1d")],
  },
  {
    id: "w_vix_spike",
    name: "VIX 15% day AND SPY down",
    thesis: "VIX expands 15% while SPY is red 1%. Volatility is the event; the index is the confirm.",
    logic: "all",
    windowMinutes: 1440,
    advantageMs: 3000,
    priceUsdc: 0.15,
    billing: "per-ping",
    deliveries: ["sse", "webhook", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_vix_spike", "vix", 15, 1440, "up", "VIX ≥ +15% / 1d"),
      leg("w_vix_spike", "spy", 1, 1440, "down", "SPY ≤ −1% / 1d"),
    ],
  },
  {
    id: "w_oil_usd",
    name: "Oil up, loonie implied",
    thesis: "USO +3% on the day and USD/CAD −0.3%. Commodity dollar, not a single ticker.",
    logic: "all",
    windowMinutes: 1440,
    advantageMs: 2600,
    priceUsdc: 0.07,
    billing: "per-ping",
    deliveries: ["sse", "agentmail"],
    lane: "finance",
    legs: [
      leg("w_oil_usd", "uso", 3, 1440, "up", "USO ≥ +3% / 1d"),
      leg("w_oil_usd", "usdcad", 0.3, 1440, "down", "USDCAD ≤ −0.3% / 1d"),
    ],
  },
];

export function pctChange(from: number, to: number) {
  if (!from || !Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

export function legMatches(direction: Direction, threshold: number, pct: number) {
  if (direction === "up") return pct >= threshold;
  if (direction === "down") return pct <= -threshold;
  return Math.abs(pct) >= threshold;
}

export function hitRate(pcts: number[], direction: Direction, threshold: number) {
  if (!pcts.length) return 0;
  const n = pcts.filter((p) => legMatches(direction, threshold, p)).length;
  return n / pcts.length;
}

export function scoreWatch(logic: "all" | "any", legs: { matched: boolean; pct: number; threshold: number }[]) {
  if (!legs.length) return 0;
  const parts = legs.map((l) => Math.min(1, Math.abs(l.pct) / Math.max(l.threshold, 1e-6)));
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  const ok = logic === "all" ? legs.every((l) => l.matched) : legs.some((l) => l.matched);
  return ok ? Math.min(0.99, 0.55 + avg * 0.4) : Math.min(0.49, avg * 0.4);
}

export type PairDef = {
  a: string;
  b: string;
  windowMinutes: number;
  thesis: string;
};

export const PAIR_BOOK: PairDef[] = [
  { a: "btc", b: "eth", windowMinutes: 60, thesis: "Majors. Divergence is the ping." },
  { a: "btc", b: "spy", windowMinutes: 1440, thesis: "Risk appetite. Uncouple and books are late." },
  { a: "eth", b: "sol", windowMinutes: 60, thesis: "Crypto beta. SOL leads, ETH confirms." },
  { a: "eurusd", b: "gbpusd", windowMinutes: 240, thesis: "G10 risk, not one-pair flow." },
  { a: "nvda", b: "qqq", windowMinutes: 1440, thesis: "Single-name versus the book." },
  { a: "gld", b: "usdjpy", windowMinutes: 1440, thesis: "Haven bid versus dollar-yen." },
  { a: "uso", b: "usdcad", windowMinutes: 1440, thesis: "Oil and the loonie." },
  { a: "vix", b: "spy", windowMinutes: 1440, thesis: "Fear versus the index. Inverse is the confirm." },
  { a: "tlt", b: "spy", windowMinutes: 1440, thesis: "Duration versus risk." },
  { a: "btc", b: "doge", windowMinutes: 60, thesis: "Reserve versus meme beta." },
];

export const HORIZONS: { lane: Lane; title: string; note: string }[] = [
  { lane: "finance", title: "Finance", note: "Live. Crypto, G10, equities. Percent moves over 1h / 4h / 1d." },
  { lane: "news", title: "World events / news", note: "Reserved. Headline prints join a book the same way a 10% hour does." },
  { lane: "elections", title: "Elections", note: "Reserved. Polling jumps as a condition, not a take." },
  { lane: "ads", title: "Advertising", note: "Reserved. Spend and attention shocks as a third print." },
  { lane: "sentiment", title: "Sentiment", note: "Reserved. Crowd tone as correlation fuel — never as a grant." },
];
