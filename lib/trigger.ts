/**
 * Condition gate for a paid ping.
 *
 * A leg fires only on a sample whose provider timestamp is strictly after the
 * monitor started and inside the watch deadline. The move is versus the live
 * baseline captured at start, using the same direction/threshold rules as the
 * watch book (`legMatches`). `all` means every leg matches on this observation;
 * `any` means one does. Partial hits are not latched.
 *
 * Correlation is Pearson on aligned consecutive returns over that window
 * (`pearson` in lib/score.ts). One leg has no Pearson: the value is null.
 * Fewer than 8 aligned returns is also null. Nothing here is hard-coded to 0.99.
 * `scoreWatch` is a desk score and is not a correlation.
 */
import { legMatches, pctChange, type Direction } from "@/lib/agency";
import { QUOTE_FUTURE_SKEW_MS } from "@/lib/markets";
import { pearson } from "@/lib/score";

export type TriggerLeg = {
  id: string;
  instrumentId: string;
  event: string;
  direction: Direction;
  thresholdPct: number;
};

export type TriggerQuote = {
  instrumentId: string;
  price: number;
  asOf: number;
  ok: boolean;
  stale: boolean;
};

export type LegObservation = {
  id: string;
  instrumentId: string;
  event: string;
  direction: Direction;
  thresholdPct: number;
  price: number | null;
  asOf: number | null;
  baseline: number | null;
  pct: number | null;
  matched: boolean;
  ignored: string | null;
};

export type TriggerSample = { at: number; prices: Record<string, number> };

export type TriggerDecision =
  | { action: "pending"; sample: TriggerSample | null; legs: LegObservation[] }
  | {
      action: "fire";
      firedAt: number;
      sample: TriggerSample;
      legs: LegObservation[];
      correlation: number | null;
      correlationSamples: number;
      correlationNote: string;
    }
  | {
      action: "no-move";
      legs: LegObservation[];
      correlation: number | null;
      correlationSamples: number;
      correlationNote: string;
    };

export type CorrelationMeasure = {
  correlation: number | null;
  samples: number;
  note: string;
};

function finitePrice(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** Why a quote cannot move a leg. Null means it counts. */
export function quoteIgnoreReason(
  q: TriggerQuote | undefined,
  startedAt: number,
  deadlineAt: number,
  now: number,
): string | null {
  if (!q) return "missing";
  if (!q.ok) return "provider-error";
  if (q.stale) return "stale";
  if (!finitePrice(q.price)) return "bad-price";
  if (!Number.isFinite(q.asOf)) return "bad-asof";
  if (q.asOf <= startedAt) return "before-start";
  if (q.asOf > deadlineAt) return "after-deadline";
  if (q.asOf > now + QUOTE_FUTURE_SKEW_MS) return "future";
  return null;
}

export function measureCorrelation(
  instrumentIds: string[],
  baseline: Record<string, { price: number }>,
  samples: TriggerSample[],
): CorrelationMeasure {
  if (instrumentIds.length < 2) {
    return { correlation: null, samples: 0, note: "n/a" };
  }
  const points: Record<string, number>[] = [
    Object.fromEntries(instrumentIds.map((id) => [id, baseline[id]?.price ?? Number.NaN])),
    ...samples.map((s) => s.prices),
  ];
  const returns: Record<string, number[]> = {};
  for (const id of instrumentIds) returns[id] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (instrumentIds.some((id) => !finitePrice(prev[id]) || !finitePrice(cur[id]))) continue;
    for (const id of instrumentIds) {
      returns[id]!.push((cur[id]! - prev[id]!) / prev[id]!);
    }
  }
  const n = returns[instrumentIds[0]!]!.length;
  const rhos: number[] = [];
  for (let a = 0; a < instrumentIds.length; a++) {
    for (let b = a + 1; b < instrumentIds.length; b++) {
      const rho = pearson(returns[instrumentIds[a]!]!, returns[instrumentIds[b]!]!);
      if (rho == null) {
        return {
          correlation: null,
          samples: n,
          note: n < 8 ? "insufficient-samples" : "undefined",
        };
      }
      rhos.push(rho);
    }
  }
  if (!rhos.length) return { correlation: null, samples: n, note: "undefined" };
  const mean = rhos.reduce((s, x) => s + x, 0) / rhos.length;
  return { correlation: mean, samples: n, note: "pearson" };
}

export function decideTrigger(input: {
  logic: "all" | "any";
  legs: TriggerLeg[];
  baseline: Record<string, { price: number; asOf: number }>;
  samples: TriggerSample[];
  quotes: TriggerQuote[];
  startedAt: number;
  deadlineAt: number;
  now: number;
}): TriggerDecision {
  const byId = new Map(input.quotes.map((q) => [q.instrumentId, q]));
  const legs: LegObservation[] = input.legs.map((leg) => {
    const base = input.baseline[leg.instrumentId];
    const q = byId.get(leg.instrumentId);
    const ignored = !base || !finitePrice(base.price) ? "no-baseline" : quoteIgnoreReason(q, input.startedAt, input.deadlineAt, input.now);
    if (ignored || !q || !base) {
      return {
        id: leg.id,
        instrumentId: leg.instrumentId,
        event: leg.event,
        direction: leg.direction,
        thresholdPct: leg.thresholdPct,
        price: q?.ok ? q.price : null,
        asOf: q?.asOf ?? null,
        baseline: base?.price ?? null,
        pct: null,
        matched: false,
        ignored: ignored ?? "missing",
      };
    }
    const pct = pctChange(base.price, q.price);
    const matched = legMatches(leg.direction, leg.thresholdPct, pct);
    return {
      id: leg.id,
      instrumentId: leg.instrumentId,
      event: leg.event,
      direction: leg.direction,
      thresholdPct: leg.thresholdPct,
      price: q.price,
      asOf: q.asOf,
      baseline: base.price,
      pct,
      matched,
      ignored: null,
    };
  });

  const usable = legs.filter((l) => l.ignored == null && l.asOf != null && l.price != null);
  const sample: TriggerSample | null = usable.length
    ? {
        at: Math.max(...usable.map((l) => l.asOf!)),
        prices: Object.fromEntries(usable.map((l) => [l.instrumentId, l.price!])),
      }
    : null;
  const series = sample ? [...input.samples, sample] : input.samples;
  const corr = measureCorrelation(
    input.legs.map((l) => l.instrumentId),
    input.baseline,
    series,
  );
  const matched = input.logic === "all" ? legs.every((l) => l.matched) : legs.some((l) => l.matched);
  if (matched && sample) {
    const firing = legs.filter((l) => l.matched && l.asOf != null);
    const firedAt = Math.max(...firing.map((l) => l.asOf!));
    return {
      action: "fire",
      firedAt,
      sample,
      legs,
      correlation: corr.correlation,
      correlationSamples: corr.samples,
      correlationNote: corr.note,
    };
  }
  if (input.now >= input.deadlineAt) {
    return {
      action: "no-move",
      legs,
      correlation: corr.correlation,
      correlationSamples: corr.samples,
      correlationNote: corr.note,
    };
  }
  return { action: "pending", sample, legs };
}
