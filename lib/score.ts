/** Pure agency scoring. No DB. Shared by preview patrol and production edge. */

import {
  INSTRUMENTS,
  PAIR_BOOK,
  WATCH_BOOK,
  hitRate,
  legMatches,
  scoreWatch,
  type Direction,
} from "@/lib/agency";
import { moveFromBars, rollingPcts, type Series } from "@/lib/markets";

export type TapeRow = {
  id: string;
  klass: string;
  name: string;
  symbol: string;
  last: number | null;
  pct1h: number | null;
  pct4h: number | null;
  pct1d: number | null;
  hit1h10: number | null;
  ok: boolean;
  error?: string;
};

export type WatchRow = {
  id: string;
  name: string;
  thesis: string;
  logic: "all" | "any";
  windowMinutes: number;
  advantageMs: number;
  priceUsdc: number;
  billing: string;
  deliveries: string[];
  hot: boolean;
  fired: boolean;
  score: number;
  event: string;
  legs: {
    id: string;
    instrumentId: string;
    label: string;
    event: string;
    direction: Direction;
    thresholdPct: number;
    windowMinutes: number;
    pct: number | null;
    matched: boolean;
    hitRate7d: number | null;
  }[];
};

export type PairRow = {
  a: string;
  b: string;
  nameA: string;
  nameB: string;
  windowMinutes: number;
  rho: number | null;
  samples: number;
  thesis: string;
};

export type Notable = {
  id: string;
  name: string;
  klass: string;
  window: string;
  pct: number;
  label: string;
};

export type ScoredAgency = {
  ranAt: string;
  note: string;
  tape: TapeRow[];
  watches: WatchRow[];
  pairs: PairRow[];
  notables: Notable[];
  firedCount: number;
  liveCount: number;
};

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 8) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  const den = Math.sqrt(vx * vy);
  if (!den || !Number.isFinite(den)) return null;
  const r = cov / den;
  if (!Number.isFinite(r)) return null;
  return Math.max(-1, Math.min(1, r));
}

export function scoreSeries(series: Series[], ranAt = new Date().toISOString()): ScoredAgency {
  const bySymbol = new Map(series.map((s) => [s.symbol, s]));
  const tape: TapeRow[] = [];

  for (const inst of INSTRUMENTS) {
    const s = bySymbol.get(inst.symbol);
    const m1 = s?.ok ? moveFromBars(s.bars1h, 60) : null;
    const m4 = s?.ok ? moveFromBars(s.bars1h, 240) : null;
    const mD = s?.ok ? moveFromBars(s.bars1h, 1440) : null;
    const rolls = s?.ok ? rollingPcts(s.bars1h, 60) : [];
    const hit1h10 = rolls.length ? hitRate(rolls, "abs", 10) : null;
    tape.push({
      id: inst.id,
      klass: inst.klass,
      name: inst.name,
      symbol: inst.symbol,
      last: s?.ok ? s.last : null,
      pct1h: m1?.pct ?? null,
      pct4h: m4?.pct ?? null,
      pct1d: mD?.pct ?? null,
      hit1h10,
      ok: Boolean(s?.ok),
      error: s?.error,
    });
  }

  const moveAt = (id: string, minutes: number) => {
    const row = tape.find((t) => t.id === id);
    if (!row) return null;
    if (minutes <= 60) return row.pct1h;
    if (minutes <= 240) return row.pct4h;
    return row.pct1d;
  };

  const watches: WatchRow[] = WATCH_BOOK.map((w) => {
    const legs = w.legs.map((l) => {
      const pct = moveAt(l.instrumentId, l.windowMinutes);
      const matched = pct != null && legMatches(l.direction, l.thresholdPct, pct);
      const inst = tape.find((t) => t.id === l.instrumentId);
      return {
        ...l,
        pct,
        matched,
        hitRate7d: l.windowMinutes <= 60 ? (inst?.hit1h10 ?? null) : null,
      };
    });
    const fired = w.logic === "all" ? legs.every((l) => l.matched) : legs.some((l) => l.matched);
    const score = scoreWatch(
      w.logic,
      legs.map((l) => ({ matched: l.matched, pct: l.pct ?? 0, threshold: l.thresholdPct })),
    );
    return {
      id: w.id,
      name: w.name,
      thesis: w.thesis,
      logic: w.logic,
      windowMinutes: w.windowMinutes,
      advantageMs: w.advantageMs,
      priceUsdc: w.priceUsdc,
      billing: w.billing,
      deliveries: w.deliveries,
      hot: Boolean(w.hot),
      fired,
      score,
      event: legs.map((l) => l.event).join(w.logic === "all" ? "+" : "|"),
      legs,
    };
  });

  const byId = new Map(INSTRUMENTS.map((i) => [i.id, i]));
  const seriesById = new Map<string, Series>();
  for (const inst of INSTRUMENTS) {
    const s = bySymbol.get(inst.symbol);
    if (s) seriesById.set(inst.id, s);
  }

  const pairs: PairRow[] = PAIR_BOOK.map((p) => {
    const sa = seriesById.get(p.a);
    const sb = seriesById.get(p.b);
    const ia = byId.get(p.a);
    const ib = byId.get(p.b);
    let rho: number | null = null;
    let samples = 0;
    if (sa?.ok && sb?.ok) {
      const ra = rollingPcts(sa.bars1h, p.windowMinutes);
      const rb = rollingPcts(sb.bars1h, p.windowMinutes);
      samples = Math.min(ra.length, rb.length);
      rho = pearson(ra.slice(-samples), rb.slice(-samples));
    }
    return {
      a: p.a,
      b: p.b,
      nameA: ia?.name ?? p.a,
      nameB: ib?.name ?? p.b,
      windowMinutes: p.windowMinutes,
      rho,
      samples,
      thesis: p.thesis,
    };
  });

  const notables: Notable[] = [];
  for (const row of tape) {
    if (!row.ok) continue;
    const checks: { pct: number | null; window: string; floor: number }[] = [
      { pct: row.pct1h, window: "1h", floor: row.klass === "forex" ? 0.35 : 5 },
      { pct: row.pct4h, window: "4h", floor: row.klass === "forex" ? 0.5 : 7 },
      { pct: row.pct1d, window: "1d", floor: row.klass === "forex" ? 0.7 : 8 },
    ];
    for (const c of checks) {
      if (c.pct == null || Math.abs(c.pct) < c.floor) continue;
      notables.push({
        id: `${row.id}.${c.window}`,
        name: row.name,
        klass: row.klass,
        window: c.window,
        pct: c.pct,
        label: c.pct > 0 ? "expansion print" : "contraction print",
      });
    }
  }
  notables.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  const live = tape.filter((t) => t.ok).length;
  const firedCount = watches.filter((w) => w.fired).length;
  const note = `Patrol ${ranAt}: ${live}/${tape.length} prints live, ${firedCount} watches fired, ${notables.length} notables. Correlation is an estimate. Not investment advice.`;

  return { ranAt, note, tape, watches, pairs, notables: notables.slice(0, 12), firedCount, liveCount: live };
}
