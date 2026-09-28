import type { Metadata } from "next";
import { WATCHES, type Watch } from "@/lib/protocol";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Edge",
  description:
    "Live Harbinger watch catalog: id, thesis, window, price, correlation, and advantage window. Cells cite /v1/watches or n/a. Not investment advice.",
  alternates: { canonical: "https://www.x403-harbinger.com/edge" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Edge · Harbinger",
    description: "Informational watch table from live /v1/watches. No invented hit-rates or PnL.",
    url: "https://www.x403-harbinger.com/edge",
    type: "website",
  },
};

type WatchRow = {
  id: string;
  thesis: string;
  windowMs: number | null;
  priceUsdc: number | null;
  advantageMs: number | null;
};

function formatWindow(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function formatPrice(usdc: number | null): string {
  if (usdc == null || !Number.isFinite(usdc)) return "n/a";
  return `${usdc} USDC`;
}

function formatAdvantage(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  return `${ms} ms`;
}

function asRow(raw: unknown): WatchRow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.id !== "string" || !w.id) return null;
  return {
    id: w.id,
    thesis: typeof w.thesis === "string" ? w.thesis : "n/a",
    windowMs: typeof w.windowMs === "number" ? w.windowMs : null,
    priceUsdc: typeof w.priceUsdc === "number" ? w.priceUsdc : null,
    advantageMs: typeof w.advantageMs === "number" ? w.advantageMs : null,
  };
}

async function loadWatchRows(): Promise<{ rows: WatchRow[]; source: string }> {
  try {
    const res = await fetch("https://www.x403-harbinger.com/v1/watches", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { watches?: unknown };
      const list = Array.isArray(data.watches) ? data.watches : [];
      const rows = list.map(asRow).filter((r): r is WatchRow => r != null);
      if (rows.length > 0) return { rows, source: "GET /v1/watches" };
    }
  } catch {
    // fall through to in-repo catalog (same definitions the API route serves)
  }
  const rows = (WATCHES as Watch[]).map((w) => ({
    id: w.id,
    thesis: w.thesis,
    windowMs: w.windowMs,
    priceUsdc: w.priceUsdc,
    advantageMs: typeof w.advantageMs === "number" ? w.advantageMs : null,
  }));
  return { rows, source: "local WATCHES (API fetch unavailable)" };
}

export default async function EdgePage() {
  const { rows, source } = await loadWatchRows();

  return (
    <main className="main">
      <section>
        <p className="tape">GET /edge · watch catalog</p>
        <h1 className="display">Edge</h1>
        <p className="muted">
          Informational table of live watches. Cells cite prints from{" "}
          <span className="mono">/v1/watches</span> or show <span className="mono">n/a</span>.
          Correlation is not published on the watches catalog in this release — shown as n/a.
          No hit-rates. No performance ledger.
        </p>
        <p className="mono" style={{ marginTop: 8 }}>
          Source · {source} · {rows.length} watches
        </p>
      </section>

      <article className="panel">
        <p className="tape">Watches</p>
        <div className="table-wrap">
          <table className="tape-table">
            <thead>
              <tr>
                <th scope="col">Id</th>
                <th scope="col">Thesis</th>
                <th scope="col">Window</th>
                <th scope="col">Price</th>
                <th scope="col">Correlation</th>
                <th scope="col">Advantage ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.id}</td>
                  <td>{w.thesis}</td>
                  <td className="mono">{formatWindow(w.windowMs)}</td>
                  <td className="mono">{formatPrice(w.priceUsdc)}</td>
                  <td className="mono">n/a</td>
                  <td className="mono">{formatAdvantage(w.advantageMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel">
        <p className="tape">Disclaimer</p>
        <p className="muted" style={{ margin: 0 }}>
          Not investment advice. Not financial advice. Informational only — correlation and
          advantage figures (when present) are protocol estimates from the watch catalog, not performance claims. Harbinger notifies when named prints line up; it does not execute
          trades.
        </p>
      </article>
    </main>
  );
}
