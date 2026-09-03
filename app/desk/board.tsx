"use client";

import Link from "next/link";
import { useState } from "react";
import type { DeskPrint, DeskSnapshot } from "@/lib/desk";

function fmtPct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function fmtPx(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}
function pctClass(n: number | null | undefined) {
  if (n == null) return "";
  if (n > 0.02) return "num-up";
  if (n < -0.02) return "num-down";
  return "";
}

export function Board({ initial }: { initial: DeskSnapshot }) {
  const [snap, setSnap] = useState<DeskSnapshot>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/v1/tape", { method: "POST" });
      const body = (await res.json()) as DeskSnapshot & { note?: string };
      if (!res.ok) {
        setErr(`HTTP ${res.status}`);
        return;
      }
      setSnap({
        ...snap,
        ...body,
        videos: snap.videos,
        network: snap.network,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="main">
      <section className="grid-3">
        <div>
          <p className="tape">free desk · last print is free · join is not</p>
          <h1 className="display">A public tape so humans — and their agents — can find the edge.</h1>
          <p className="muted">
            Hot coins, the loudest G10 pair, Tesla live. SpaceX, xAI, and X stay last-reported marks —
            they are not listed. Briefs and two live news feeds sit under the tape. Correlation watches
            still answer 403 until hp1. Not investment advice.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn primary" disabled={busy} onClick={() => void refresh()}>
              {busy ? "Refreshing…" : "Refresh the free tape"}
            </button>
            <Link href="/agency" className="btn ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Paid joins
            </Link>
          </div>
        </div>
        <section className="panel">
          <p className="tape">Free pings · no grant</p>
          <ul className="list">
            {snap.freePings.map((p) => (
              <li className="item" key={p.id}>
                <span className="pill ok">free</span>{" "}
                <span className="mono">{p.id}</span>
                <p style={{ margin: "6px 0 0" }}>{p.name}</p>
                <p className={`mono ${pctClass(p.pct)}`} style={{ marginTop: 4 }}>
                  {p.label}
                </p>
              </li>
            ))}
          </ul>
          <p className="mono" style={{ marginTop: 12 }}>{snap.note}</p>
          {err ? <p className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</p> : null}
        </section>
      </section>

      <section>
        <p className="tape">Highest movers · 1d</p>
        <div className="table-wrap">
          <table className="tape-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Desk</th>
                <th>Last</th>
                <th>1h</th>
                <th>1d</th>
              </tr>
            </thead>
            <tbody>
              {snap.movers.map((r) => (
                <PrintRow key={r.id} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="tape">Hot coins · new-ish tape</p>
        <div className="table-wrap">
          <table className="tape-table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Desk</th>
                <th>Last</th>
                <th>1h</th>
                <th>1d</th>
              </tr>
            </thead>
            <tbody>
              {snap.hot
                .slice()
                .sort((a, b) => Math.abs(b.pct1d ?? 0) - Math.abs(a.pct1d ?? 0))
                .map((r) => (
                  <PrintRow key={r.id} row={r} />
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="tape">G10 · loudest pairs first</p>
        <div className="table-wrap">
          <table className="tape-table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Desk</th>
                <th>Last</th>
                <th>1h</th>
                <th>1d</th>
              </tr>
            </thead>
            <tbody>
              {snap.fx
                .slice()
                .sort((a, b) => Math.abs(b.pct1d ?? 0) - Math.abs(a.pct1d ?? 0))
                .map((r) => (
                  <PrintRow key={r.id} row={r} />
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <p className="tape">X desk · Tesla live · SpaceX / xAI / X as marks</p>
        <div className="grid-3 cols-3" style={{ marginTop: 12 }}>
          {snap.xListed.map((r) => (
            <article className="panel" key={r.id}>
              <p className="tape">listed</p>
              <h2>{r.name}</h2>
              <p className="mono">{r.symbol}</p>
              <p className="stat v" style={{ marginTop: 8 }}>{fmtPx(r.last)}</p>
              <p className={`mono ${pctClass(r.pct1d)}`}>{fmtPct(r.pct1d)} / 1d · {fmtPct(r.pct1h)} / 1h</p>
            </article>
          ))}
          {snap.xPrivate.map((x) => (
            <article className="panel" key={x.id}>
              <p className="tape">unlisted · last reported</p>
              <h2>{x.name}</h2>
              <p className="muted">{x.note}</p>
              <p className="mono" style={{ marginTop: 8 }}>{x.mark}</p>
              {x.source ? <p className="mono">{x.source}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="grid-3">
        <article className="panel span-2">
          <p className="tape">Briefs · Tesla, SpaceX, xAI, crypto, agents</p>
          <ul className="list">
            {snap.briefs.map((b) => (
              <li className="item" key={b.href}>
                <a href={b.href} rel="noopener noreferrer" target="_blank" className="news-link">
                  {b.title}
                </a>
                <p className="mono" style={{ marginTop: 6 }}>
                  {b.source}
                  {b.published ? ` · ${b.published}` : ""}
                </p>
              </li>
            ))}
          </ul>
          {!snap.briefs.length ? <p className="muted">No briefs this pass.</p> : null}
        </article>
        <article className="panel">
          <p className="tape">Network</p>
          <ul className="list">
            {snap.network.map((n) => (
              <li className="item" key={n.id}>
                <a href={n.href} className="news-link" {...(n.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {n.name}
                </a>
                <p className="mono">{n.host}</p>
                <p className="muted" style={{ marginTop: 6 }}>{n.note}</p>
              </li>
            ))}
          </ul>
          <p className="tape" style={{ marginTop: 16 }}>Cloudflare</p>
          <p className="muted">
            This edge is on Vercel. Point www and the apex through Cloudflare DNS if you want the orange
            cloud — SSL full (strict), keep Bot Fight / Browser Integrity / SSO off so agents get a
            Harbinger 403, not a JS challenge. Cloudflare is not an app connector on this project.
          </p>
        </article>
      </section>

      <section id="feeds">
        <p className="tape">Live news · when the channel is on</p>
        <div className="grid-3 cols-2" style={{ marginTop: 12 }}>
          {snap.videos.map((v) => (
            <article className="panel" key={v.id}>
              <p className="tape">{v.title}</p>
              <p className="muted">{v.note}</p>
              <div className="video">
                <iframe
                  title={v.title}
                  src={`https://www.youtube-nocookie.com/embed/live_stream?channel=${v.channel}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <p className="mono" style={{ marginTop: 8 }}>
                <a href={`https://www.youtube.com/channel/${v.channel}`} rel="noopener noreferrer" target="_blank">
                  Open on YouTube
                </a>
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function PrintRow({ row }: { row: DeskPrint }) {
  return (
    <tr>
      <td>
        {row.name}
        <div className="mono">{row.symbol}</div>
      </td>
      <td className="mono">{row.desk}</td>
      <td className="mono">{fmtPx(row.last)}</td>
      <td className={`mono ${pctClass(row.pct1h)}`}>{fmtPct(row.pct1h)}</td>
      <td className={`mono ${pctClass(row.pct1d)}`}>{fmtPct(row.pct1d)}</td>
    </tr>
  );
}
