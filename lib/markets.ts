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

type YahooChart = {
  chart?: {
    result?: Array<{
      meta?: { symbol?: string; regularMarketPrice?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { description?: string };
  };
};

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
  const ts = result.timestamp ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && Number.isFinite(c)) bars.push({ t: ts[i]! * 1000, close: c });
  }
  return bars;
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
