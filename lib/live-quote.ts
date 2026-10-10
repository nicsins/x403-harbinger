/** Leg quotes for the paid trigger. Tests replace the fetcher; production calls Yahoo. */
import { INSTRUMENTS } from "@/lib/agency";
import { fetchLiveQuote, type LiveQuote } from "@/lib/markets";

export type InstrumentQuote = LiveQuote & { instrumentId: string };

type Fetcher = (instrumentIds: string[], now: number) => Promise<InstrumentQuote[]>;

let testFetcher: Fetcher | null = null;

/** Tests only. Pass null to restore the Yahoo fetcher. */
export function setInstrumentQuoteFetcherForTests(fn: Fetcher | null): void {
  testFetcher = fn;
}

export async function fetchInstrumentQuotes(instrumentIds: string[], now: number): Promise<InstrumentQuote[]> {
  if (testFetcher) return testFetcher(instrumentIds, now);
  const byId = new Map(INSTRUMENTS.map((i) => [i.id, i.symbol]));
  const out: InstrumentQuote[] = [];
  for (const id of instrumentIds) {
    const symbol = byId.get(id);
    if (!symbol) {
      out.push({
        instrumentId: id,
        symbol: id,
        price: 0,
        asOf: 0,
        ok: false,
        stale: true,
        source: "yahoo-chart",
        interval: "1m",
        error: "unknown-instrument",
      });
      continue;
    }
    const q = await fetchLiveQuote(symbol, now);
    out.push({ ...q, instrumentId: id });
  }
  return out;
}
