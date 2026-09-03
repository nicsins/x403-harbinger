import { INSTRUMENTS } from "@/lib/agency";
import { FREE_PINGS, HOT_COINS, NETWORK_EDGES, VIDEO_FEEDS, X_DESK, type DeskPrint, type DeskSnapshot, type FreePing } from "@/lib/desk";
import { fetchBriefs } from "@/lib/news";
import { fetchMany, moveFromBars } from "@/lib/markets";

export type { DeskPrint, DeskSnapshot, FreePing };

let mem: { at: number; snap: DeskSnapshot } | null = null;
const TTL = 180_000;

function toPrint(
  id: string,
  name: string,
  symbol: string,
  klass: DeskPrint["klass"],
  desk: DeskPrint["desk"],
  series: { last: number; bars1h: { t: number; close: number }[]; ok: boolean } | undefined,
): DeskPrint {
  const m1 = series?.ok ? moveFromBars(series.bars1h, 60) : null;
  const mD = series?.ok ? moveFromBars(series.bars1h, 1440) : null;
  return {
    id,
    name,
    symbol,
    klass,
    last: series?.ok ? series.last : null,
    pct1h: m1?.pct ?? null,
    pct1d: mD?.pct ?? null,
    ok: Boolean(series?.ok),
    desk,
  };
}

function abs(n: number | null) {
  return n == null ? -1 : Math.abs(n);
}

async function buildDesk(): Promise<DeskSnapshot> {
  const fx = INSTRUMENTS.filter((i) => i.klass === "forex");
  const listed = X_DESK.filter((x) => x.listed && x.symbol);
  const symbols = [
    ...HOT_COINS.map((c) => c.symbol),
    ...fx.map((i) => i.symbol),
    ...listed.map((x) => x.symbol!),
  ];
  const series = await fetchMany(symbols, 8);
  const by = new Map(series.map((s) => [s.symbol, s]));

  const hot = HOT_COINS.map((c) => toPrint(c.id, c.name, c.symbol, "crypto", "hot", by.get(c.symbol)));
  const fxRows = fx.map((i) => toPrint(i.id, i.name, i.symbol, "forex", "fx", by.get(i.symbol)));
  const xListed = listed.map((x) => toPrint(x.id, x.name, x.symbol!, "equity", "x", by.get(x.symbol!)));

  const movers = [...hot, ...fxRows, ...xListed]
    .filter((r) => r.ok && r.pct1d != null)
    .sort((a, b) => abs(b.pct1d) - abs(a.pct1d))
    .slice(0, 6);

  const hotLeader = [...hot].sort((a, b) => abs(b.pct1h) - abs(a.pct1h))[0];
  const fxLeader = [...fxRows].sort((a, b) => abs(b.pct1d) - abs(a.pct1d))[0];
  const tsla = xListed.find((r) => r.id === "tsla");

  const fmt = (p: number | null) => (p == null ? "—" : `${p > 0 ? "+" : ""}${p.toFixed(2)}%`);
  const freePings: FreePing[] = [
    {
      ...FREE_PINGS[0]!,
      label: hotLeader?.ok ? `${hotLeader.name} ${fmt(hotLeader.pct1h)} / 1h` : "waiting on tape",
      pct: hotLeader?.pct1h ?? null,
      symbol: hotLeader?.symbol ?? null,
    },
    {
      ...FREE_PINGS[1]!,
      label: fxLeader?.ok ? `${fxLeader.name} ${fmt(fxLeader.pct1d)} / 1d` : "waiting on tape",
      pct: fxLeader?.pct1d ?? null,
      symbol: fxLeader?.symbol ?? null,
    },
    {
      ...FREE_PINGS[2]!,
      label: tsla?.ok ? `Tesla ${fmt(tsla.pct1d)} / 1d` : "waiting on tape",
      pct: tsla?.pct1d ?? null,
      symbol: tsla?.symbol ?? null,
    },
  ];

  const briefs = await fetchBriefs(8);
  const now = new Date().toISOString();
  const live = [...hot, ...fxRows, ...xListed].filter((r) => r.ok).length;
  return {
    ranAt: now,
    note: `Free desk ${now}: ${live} live prints, ${briefs.length} briefs. Last print is free. The join is still 403. Not investment advice.`,
    hot,
    fx: fxRows,
    xListed,
    xPrivate: X_DESK.filter((x) => !x.listed),
    movers,
    freePings,
    briefs,
    videos: VIDEO_FEEDS,
    network: NETWORK_EDGES,
  };
}

export async function performDesk(force = false): Promise<DeskSnapshot> {
  if (!force && mem && Date.now() - mem.at < TTL) return mem.snap;
  const snap = await buildDesk();
  mem = { at: Date.now(), snap };
  return snap;
}

export function tapeBody(snap: DeskSnapshot) {
  return {
    protocol: "x403-HARBINGER/1.0",
    catalog: "tape",
    grant: "not-required",
    note: snap.note,
    ranAt: snap.ranAt,
    freePings: snap.freePings,
    movers: snap.movers,
    hot: snap.hot,
    fx: snap.fx,
    xListed: snap.xListed,
    xPrivate: snap.xPrivate,
    briefs: snap.briefs,
  };
}
