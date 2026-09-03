import { HORIZONS, INSTRUMENTS, PAIR_BOOK, SWARM, WATCH_BOOK } from "@/lib/agency";
import { fetchMany } from "@/lib/markets";
import { scoreSeries, type ScoredAgency } from "@/lib/score";

let cache: { at: number; scored: ScoredAgency } | null = null;
const TTL_MS = 180_000;

export function catalogBody() {
  return {
    instruments: INSTRUMENTS,
    watches: WATCH_BOOK.map((w) => ({
      id: w.id,
      name: w.name,
      thesis: w.thesis,
      logic: w.logic,
      windowMinutes: w.windowMinutes,
      priceUsdc: w.priceUsdc,
      legs: w.legs.map((l) => ({
        event: l.event,
        label: l.label,
        thresholdPct: l.thresholdPct,
        direction: l.direction,
        windowMinutes: l.windowMinutes,
      })),
    })),
    pairs: PAIR_BOOK,
    swarm: SWARM,
    horizons: HORIZONS,
    lastPatrol: cache?.scored ?? null,
  };
}

export function lastScored() {
  return cache?.scored ?? null;
}

export async function runPatrol(force = false): Promise<ScoredAgency> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.scored;
  const series = await fetchMany(
    INSTRUMENTS.map((i) => i.symbol),
    8,
  );
  const scored = scoreSeries(series);
  cache = { at: Date.now(), scored };
  return scored;
}
