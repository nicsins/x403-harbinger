/** Server-only Yahoo chart pull. Crypto, FX, and equity on one tape.
 *
 * Patrol scoring keeps 60-minute bars (`fetchSeries`). Paid triggers use a
 * separate current-quote path (`fetchQuote`): Yahoo `regularMarketPrice` /
 * `regularMarketTime` when that timestamp is the newest, otherwise the last
 * 1-minute bar. As-of is the provider timestamp in milliseconds, not the
 * request time. A quote older than QUOTE_MAX_AGE_MS is stale and must not arm
 * or fire a monitor. This source is minute-resolution; it does not support a
 * sub-minute crossing time.
 */

export type Bar = { t: number; close: number };
export type Series = {
  symbol: string;
  last: number;
  bars1h: Bar[];
  ok: boolean;
  error?: string;
};

export type Quote = {
  symbol: string;
  price: number | null;
  /** Provider timestamp, epoch ms. Null when Yahoo gave no usable time. */
  asOf: number | null;
  ok: boolean;
  stale: boolean;
  source: "yahoo-chart";
  interval: "1m";
  error?: string;
};

/** 1-minute bars plus a small lag budget. Older than this cannot fire. */
export const QUOTE_MAX_AGE_MS = 5 * 60_000;

const UA = "Mozilla/5.0 (compatible; HarbingerAgency/1.0; +https://www.x403-harbinger.com)";

export type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; regularMarketPrice?: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { description?: string };
  };
};

type ChartPoint = {
  bars: Bar[];
  marketPrice: number | null;
  marketTimeMs: number | null;
};

function barsFromResult(result: NonNullable<NonNullable<YahooChart["chart"]>["result"]>[number]): Bar[] {
  const ts = result.timestamp ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && Number.isFinite(c)) bars.push({ t: ts[i]! * 1000, close: c });
  }
  return bars;
}

async function yahooChart(symbol: string, interval: string, range: string): Promise<ChartPoint> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const body = (await res.json()) as YahooChart;
  return chartPoint(body);
}

function chartPoint(body: YahooChart): ChartPoint {
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(body.chart?.error?.description ?? "no result");
  const meta = result.meta;
  const marketPrice =
    typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : null;
  const marketTimeMs =
    typeof meta?.regularMarketTime === "number" && Number.isFinite(meta.regularMarketTime)
      ? meta.regularMarketTime * 1000
      : null;
  return { bars: barsFromResult(result), marketPrice, marketTimeMs };
}

/** Parse a Yahoo chart payload into a trigger quote. `now` is only the stale clock. */
export function quoteFromYahoo(symbol: string, body: YahooChart, now: number): Quote {
  try {
    const point = chartPoint(body);
    return quoteFromPoint(symbol, point, now);
  } catch (err) {
    return badQuote(symbol, err instanceof Error ? err.message : "fetch failed");
  }
}

function quoteFromPoint(symbol: string, point: ChartPoint, now: number): Quote {
  let price: number | null = null;
  let asOf: number | null = null;
  if (point.marketPrice != null && point.marketPrice > 0 && point.marketTimeMs != null) {
    price = point.marketPrice;
    asOf = point.marketTimeMs;
  }
  const last = point.bars.at(-1);
  if (last && last.close > 0 && (asOf == null || last.t >= asOf)) {
    price = last.close;
    asOf = last.t;
  }
  if (price == null || asOf == null) return badQuote(symbol, "empty");
  const stale = asOf > now + 120_000 || now - asOf > QUOTE_MAX_AGE_MS;
  return { symbol, price, asOf, ok: true, stale, source: "yahoo-chart", interval: "1m" };
}

function badQuote(symbol: string, error: string): Quote {
  return { symbol, price: null, asOf: null, ok: false, stale: true, source: "yahoo-chart", interval: "1m", error };
}

export async function fetchQuote(symbol: string, now = Date.now()): Promise<Quote> {
  try {
    const point = await yahooChart(symbol, "1m", "1d");
    return quoteFromPoint(symbol, point, now);
  } catch (err) {
    return badQuote(symbol, err instanceof Error ? err.message : "fetch failed");
  }
}

export async function fetchQuotes(symbols: string[], now = Date.now()): Promise<Quote[]> {
  const out: Quote[] = new Array(symbols.length);
  let cursor = 0;
  async function worker() {
    while (cursor < symbols.length) {
      const i = cursor++;
      out[i] = await fetchQuote(symbols[i]!, now);
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, symbols.length) }, worker));
  return out;
}

export async function fetchSeries(symbol: string): Promise<Series> {
  try {
    const point = await yahooChart(symbol, "60m", "7d");
    const last = point.bars.at(-1)?.close;
    if (!last) throw new Error("empty");
    return { symbol, last, bars1h: point.bars, ok: true };
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
