/** Pure watch trigger. No clock, no network, no grant store.
 *
 * A monitor fires only on a sample strictly after it started, measured from the
 * baseline captured at arm time. Pearson is the same function patrol uses
 * (`pearson` in lib/score.ts). One leg, or fewer than 8 aligned returns, is
 * null — never a stand-in such as 0.99. `scoreWatch` is a separate score and
 * is not a correlation.
 */
import { legMatches, pctChange, type Direction } from "@/lib/agency";
import { QUOTE_MAX_AGE_MS, type Quote } from "@/lib/markets";
import { pearson } from "@/lib/score";

export type EvalLeg = {
  instrumentId: string;
  symbol: string;
  label: string;
  event: string;
  direction: Direction;
  thresholdPct: number;
  windowMinutes: number;
};

export type PriceSample = { asOf: number; prices: Record<string, number> };

export type Measurement = {
  instrumentId: string;
  symbol: string;
  label: string;
  event: string;
  direction: Direction;
  thresholdPct: number;
  windowMinutes: number;
  baseline: number;
  price: number;
  asOf: number;
  pct: number;
  matched: boolean;
};

export type CorrelationNote = "measured" | "one-leg" | "insufficient-samples" | "no-overlap";

export type TriggerState = {
  startedAt: number;
  deadlineAt: number;
  baseline: PriceSample | null;
  samples: PriceSample[];
};

export type TriggerDecision =
  | { action: "keep" }
  | { action: "save"; baseline: PriceSample; samples: PriceSample[] }
  | {
      action: "fire";
      baseline: PriceSample;
      samples: PriceSample[];
      firedAt: number;
      correlation: number | null;
      correlationNote: CorrelationNote;
      measurements: Measurement[];
    }
  | {
      action: "no-move";
      baseline: PriceSample | null;
      samples: PriceSample[];
      correlation: number | null;
      correlationNote: CorrelationNote;
      measurements: Measurement[];
    };

const MAX_SAMPLES = 2000;

export function quoteFresh(q: Quote | undefined, now: number): q is Quote & { price: number; asOf: number } {
  if (!q || !q.ok || q.stale) return false;
  if (q.price == null || q.asOf == null) return false;
  if (!Number.isFinite(q.price) || q.price <= 0) return false;
  if (!Number.isFinite(q.asOf)) return false;
  if (q.asOf > now + 120_000) return false;
  if (now - q.asOf > QUOTE_MAX_AGE_MS) return false;
  return true;
}

function aligned(legs: EvalLeg[], quotes: Map<string, Quote>, now: number): PriceSample | null {
  const prices: Record<string, number> = {};
  let asOf = Number.POSITIVE_INFINITY;
  for (const leg of legs) {
    const q = quotes.get(leg.symbol);
    if (!quoteFresh(q, now)) return null;
    prices[leg.instrumentId] = q.price;
    if (q.asOf < asOf) asOf = q.asOf;
  }
  if (!Number.isFinite(asOf)) return null;
  return { asOf, prices };
}

function measure(legs: EvalLeg[], baseline: PriceSample, sample: PriceSample): Measurement[] {
  return legs.map((leg) => {
    const base = baseline.prices[leg.instrumentId] ?? 0;
    const price = sample.prices[leg.instrumentId] ?? base;
    const pct = pctChange(base, price);
    return {
      instrumentId: leg.instrumentId,
      symbol: leg.symbol,
      label: leg.label,
      event: leg.event,
      direction: leg.direction,
      thresholdPct: leg.thresholdPct,
      windowMinutes: leg.windowMinutes,
      baseline: base,
      price,
      asOf: sample.asOf,
      pct,
      matched: legMatches(leg.direction, leg.thresholdPct, pct),
    };
  });
}

function logicHit(logic: "all" | "any", rows: Measurement[]): boolean {
  if (!rows.length) return false;
  return logic === "all" ? rows.every((r) => r.matched) : rows.some((r) => r.matched);
}

function returns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1]!;
    const b = prices[i]!;
    if (!a) return [];
    out.push(((b - a) / a) * 100);
  }
  return out;
}

/** Pearson over aligned consecutive returns. One leg is undefined. */
export function measureCorrelation(legs: EvalLeg[], points: PriceSample[]): {
  correlation: number | null;
  note: CorrelationNote;
} {
  if (legs.length < 2) return { correlation: null, note: "one-leg" };
  const series = legs.map((leg) => points.map((p) => p.prices[leg.instrumentId] ?? Number.NaN));
  if (series.some((s) => s.some((n) => !Number.isFinite(n)))) return { correlation: null, note: "no-overlap" };
  const rets = series.map(returns);
  const rhos: number[] = [];
  for (let i = 0; i < rets.length; i++) {
    for (let j = i + 1; j < rets.length; j++) {
      const n = Math.min(rets[i]!.length, rets[j]!.length);
      const r = pearson(rets[i]!.slice(0, n), rets[j]!.slice(0, n));
      if (r == null) return { correlation: null, note: "insufficient-samples" };
      rhos.push(r);
    }
  }
  if (!rhos.length) return { correlation: null, note: "no-overlap" };
  const avg = rhos.reduce((a, b) => a + b, 0) / rhos.length;
  return { correlation: Math.max(-1, Math.min(1, avg)), note: "measured" };
}

function eligible(state: TriggerState, sample: PriceSample): boolean {
  return sample.asOf > state.startedAt && sample.asOf < state.deadlineAt;
}

/**
 * One observation step.
 * The baseline sample never fires, even if its price would have crossed a
 * trailing window. Provider errors and stale quotes are ignored. At the
 * deadline with no in-window cross, the result is no-move.
 */
export function stepTrigger(
  state: TriggerState,
  logic: "all" | "any",
  legs: EvalLeg[],
  quotes: Map<string, Quote>,
  now: number,
): TriggerDecision {
  const corrOf = (baseline: PriceSample | null, samples: PriceSample[]) => {
    if (!baseline) return { correlation: null as number | null, note: (legs.length < 2 ? "one-leg" : "insufficient-samples") as CorrelationNote };
    return measureCorrelation(legs, [baseline, ...samples]);
  };

  if (!legs.length) {
    if (now >= state.deadlineAt) {
      const c = corrOf(state.baseline, state.samples);
      return {
        action: "no-move",
        baseline: state.baseline,
        samples: state.samples,
        correlation: c.correlation,
        correlationNote: legs.length < 2 ? "one-leg" : c.note,
        measurements: [],
      };
    }
    return { action: "keep" };
  }

  const sample = aligned(legs, quotes, now);
  if (!sample) {
    if (now >= state.deadlineAt) {
      const c = corrOf(state.baseline, state.samples);
      const last = state.samples.at(-1);
      return {
        action: "no-move",
        baseline: state.baseline,
        samples: state.samples,
        correlation: c.correlation,
        correlationNote: c.note,
        measurements: state.baseline && last ? measure(legs, state.baseline, last) : [],
      };
    }
    return { action: "keep" };
  }

  if (!state.baseline) {
    return { action: "save", baseline: sample, samples: state.samples };
  }

  if (sample.asOf <= state.baseline.asOf || !eligible(state, sample)) {
    if (now >= state.deadlineAt) {
      const c = corrOf(state.baseline, state.samples);
      const last = state.samples.at(-1);
      return {
        action: "no-move",
        baseline: state.baseline,
        samples: state.samples,
        correlation: c.correlation,
        correlationNote: c.note,
        measurements: last ? measure(legs, state.baseline, last) : [],
      };
    }
    return { action: "keep" };
  }

  const samples = state.samples.some((s) => s.asOf === sample.asOf)
    ? state.samples
    : [...state.samples, sample].slice(-MAX_SAMPLES);
  const rows = measure(legs, state.baseline, sample);
  if (logicHit(logic, rows)) {
    const c = measureCorrelation(legs, [state.baseline, ...samples]);
    return {
      action: "fire",
      baseline: state.baseline,
      samples,
      firedAt: sample.asOf,
      correlation: c.correlation,
      correlationNote: c.note,
      measurements: rows,
    };
  }
  if (now >= state.deadlineAt) {
    const c = measureCorrelation(legs, [state.baseline, ...samples]);
    return {
      action: "no-move",
      baseline: state.baseline,
      samples,
      correlation: c.correlation,
      correlationNote: c.note,
      measurements: rows,
    };
  }
  if (samples === state.samples) return { action: "keep" };
  return { action: "save", baseline: state.baseline, samples };
}
