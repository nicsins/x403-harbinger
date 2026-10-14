/** Server-only Yahoo chart pull. Crypto, FX, and equity on one tape. */

export type Bar = { t: number; close: number };
export type Series = {
  symbol: string;
  last: number;
  bars1h: Bar[];
  ok: boolean;
  error?: string;
};

const UA = "Mozilla/5.0 (compatible; HarbingerAgency/1.0; +https://www.x403-harbinger.com)";

/**
 * Hour bars are the patrol tape only. Their timestamp is the bar open, which can
 * sit before a paid monitor starts, so they are not a fire source.
 *
 * The paid trigger uses a 1-minute chart quote: `regularMarketPrice` with
 * `regularMarketTime` when Yahoo sends both, otherwise the last 1-minute close.
 * That is about a one-minute print, not a tick. `QUOTE_MAX_AGE_MS` rejects a
 * quote older than three minutes so a closed session cannot look like a fresh cross.
 */
export const QUOTE_MAX_AGE_MS = 180_000;
export const QUOTE_FUTURE_SKEW_MS = 15_000;

export type LiveQuote = {
  symbol: string;
  price: number;
  /** Epoch ms of the provider print (regularMarketTime or last 1m bar). */
  asOf: number;
  ok: boolean;
  /** True when the print is older than QUOTE_MAX_AGE_MS or implausibly ahead of `now`. */
  stale: boolean;
  source: "yahoo-chart";
  interval: "1m";
  error?: string;
};

type YahooMeta = {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
};

type YahooResult = {
  meta?: YahooMeta;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

export type YahooChart = {
  chart?: {
    result?: Array<YahooResult>;
    error?: { description?: string };
  };
};

function barsFromResult(result: YahooResult): Bar[] {
  const ts = result.timestamp ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && Number.isFinite(c)) bars.push({ t: ts[i]! * 1000, close: c });
  }
  return bars;
}

function badQuote(symbol: string, error: string): LiveQuote {
  return {
    symbol,
    price: 0,
    asOf: 0,
    ok: false,
    stale: true,
    source: "yahoo-chart",
    interval: "1m",
    error,
  };
}

/** Pure parser so tests can pin as-of / stale behaviour without the network. */
export function liveQuoteFromChart(symbol: string, body: YahooChart, now: number): LiveQuote {
  const result = body.chart?.result?.[0];
  if (!result) return badQuote(symbol, body.chart?.error?.description ?? "no result");
  const meta = result.meta ?? {};
  let price: number | null = null;
  let asOf: number | null = null;
  if (
    typeof meta.regularMarketPrice === "number" &&
    Number.isFinite(meta.regularMarketPrice) &&
    meta.regularMarketPrice > 0 &&
    typeof meta.regularMarketTime === "number" &&
    Number.isFinite(meta.regularMarketTime)
  ) {
    price = meta.regularMarketPrice;
    asOf = meta.regularMarketTime > 1e12 ? meta.regularMarketTime : meta.regularMarketTime * 1000;
  } else {
    const last = barsFromResult(result).at(-1);
    if (last && last.close > 0) {
      price = last.close;
      asOf = last.t;
    }
  }
  if (price == null || asOf == null) return badQuote(symbol, "empty");
  const stale = asOf > now + QUOTE_FUTURE_SKEW_MS || now - asOf > QUOTE_MAX_AGE_MS;
  return { symbol, price, asOf, ok: true, stale, source: "yahoo-chart", interval: "1m" };
}

async function yahoo(symbol: string, interval: string, range: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const body = (await res.json()) as YahooChart;
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(body.chart?.error?.description ?? "no result");
  return barsFromResult(result);
}

/** Current quote for the paid trigger. Patrol keeps using `fetchSeries` (60m bars). */
export async function fetchLiveQuote(symbol: string, now = Date.now()): Promise<LiveQuote> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return badQuote(symbol, `yahoo ${res.status}`);
    const body = (await res.json()) as YahooChart;
    return liveQuoteFromChart(symbol, body, now);
  } catch (err) {
    return badQuote(symbol, err instanceof Error ? err.message : "fetch failed");
  }
}

export async function fetchSeries(symbol: string): Promise<Series> {
  try {
    const bars1h = await yahoo(symbol, "60m", "7d");
    const last = bars1h.at(-1)?.close;
    if (!last) throw new Error("empty");
    return { symbol, last, bars1h, ok: true };
  } catch (err) {
    return {
      symbol,
      last: 0,
      bars1h: [],
      ok: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}

export async function fetchMany(symbols: string[], concurrency = 8): Promise<Series[]> {
  const out: Series[] = new Array(symbols.length);
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const i = cursor++;
      out[i] = await fetchSeries(symbols[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return out;
}

export function moveFromBars(bars: Bar[], windowMinutes: number) {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1]!;
  const spanMs = windowMinutes * 60_000;
  let prior = bars[0]!;
  for (let i = bars.length - 2; i >= 0; i--) {
    const b = bars[i]!;
    if (last.t - b.t >= spanMs * 0.85) {
      prior = b;
      break;
    }
    prior = b;
  }
  if (prior.t === last.t) prior = bars[bars.length - 2] ?? prior;
  const pct = prior.close ? ((last.close - prior.close) / prior.close) * 100 : 0;
  return { pct, from: prior.close, to: last.close, fromTs: prior.t, toTs: last.t };
}

export function rollingPcts(bars: Bar[], windowMinutes: number) {
  const span = Math.max(1, Math.round(windowMinutes / 60));
  const out: number[] = [];
  for (let i = span; i < bars.length; i++) {
    const a = bars[i - span]!.close;
    const b = bars[i]!.close;
    if (a) out.push(((b - a) / a) * 100);
  }
  return out;
}
