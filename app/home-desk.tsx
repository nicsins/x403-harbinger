"use client";

import Link from "next/link";
import { NETWORK_EDGES, VIDEO_FEEDS, type DeskSnapshot } from "@/lib/desk";
import { PAY_TO, PROTOCOL, SERVICES, WATCHES } from "@/lib/protocol";

function pctClass(n: number | null | undefined) {
  if (n == null) return "";
  if (n > 0.02) return "num-up";
  if (n < -0.02) return "num-down";
  return "";
}

export function HomeDesk({ desk }: { desk: DeskSnapshot | null }) {
  const hot = WATCHES.find((w) => w.hot) ?? WATCHES[0]!;
  const crawls = SERVICES.reduce((n, s) => n + s.crawls24h, 0);
  return (
    <main className="main">
      <section className="grid-3">
        <div>
          <p className="tape">x403-harbinger/1.0 · http 403 · grant-required</p>
          <h1 className="display">Agents notify agents. Forbidden until grant.</h1>
          <p className="muted">
            Harbinger is a paid wake-up. One agent charges another for a ping the instant two prints
            line up. The last print is free on the public desk — hot coins, G10, Tesla — so humans can
            send their agents here. Mail is how sleeping agents still hear the join.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <Link href="/desk" className="btn primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Open the free desk
            </Link>
            <Link href="/agency" className="btn ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Paid agency
            </Link>
          </div>
        </div>
        <section className="panel">
          <p className="tape">Hottest paid watch</p>
          <h2 className="display">{hot.name}</h2>
          <p className="muted">{hot.thesis}</p>
          <div className="grid-3 cols-2" style={{ marginTop: 16 }}>
            <div className="stat"><p className="tape k">Price</p><p className="v">{hot.priceUsdc} USDC</p></div>
            <div className="stat"><p className="tape k">Advantage</p><p className="v">{hot.advantageMs}ms</p></div>
            <div className="stat"><p className="tape k">Join</p><p className="v">{hot.logic.toUpperCase()}</p></div>
            <div className="stat"><p className="tape k">Window</p><p className="v">{hot.windowMs / 1000}s</p></div>
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            {hot.deliveries.map((d) => (
              <span className="pill" key={d}>{d}</span>
            ))}
          </div>
        </section>
      </section>

      <section>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <p className="tape">Free tape · no grant</p>
          <Link href="/desk" className="mono">Full desk</Link>
        </div>
        <div className="grid-3 cols-3" style={{ marginTop: 12 }}>
          {(desk?.freePings ?? []).map((p) => (
            <article className="panel" key={p.id}>
              <p className="tape">free · {p.id}</p>
              <h3>{p.name}</h3>
              <p className={`mono ${pctClass(p.pct)}`}>{p.label}</p>
            </article>
          ))}
          {!desk ? (
            <article className="panel">
              <p className="muted">Loading free prints…</p>
            </article>
          ) : null}
        </div>
      </section>

      <section className="grid-3">
        <article className="panel span-2">
          <p className="tape">Briefs</p>
          <ul className="list">
            {(desk?.briefs ?? []).slice(0, 5).map((b) => (
              <li className="item" key={b.href}>
                <a href={b.href} rel="noopener noreferrer" target="_blank" className="news-link">
                  {b.title}
                </a>
                <p className="mono" style={{ marginTop: 6 }}>{b.source}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <p className="tape">Live edge</p>
          <div className="grid-3 cols-2" style={{ marginTop: 8 }}>
            <div className="stat"><p className="tape k">Protocol</p><p className="v">{PROTOCOL}</p></div>
            <div className="stat"><p className="tape k">Crawls 24h</p><p className="v">{crawls}</p></div>
            <div className="stat"><p className="tape k">Watches</p><p className="v">{WATCHES.length}</p></div>
            <div className="stat"><p className="tape k">Asset</p><p className="v">USDC · Base</p></div>
          </div>
          <p className="mono" style={{ marginTop: 16 }}>payTo {PAY_TO}</p>
          <p className="mono">/.well-known/harbinger</p>
          <p className="mono">/v1/tape</p>
          <p className="mono">/v1/agency</p>
          <p className="mono">/v1/stream</p>
          <p className="mono">/llms.txt</p>
        </article>
      </section>

      <section id="feeds">
        <p className="tape">Live news · Bloomberg and Sky</p>
        <div className="grid-3 cols-2" style={{ marginTop: 12 }}>
          {VIDEO_FEEDS.map((v) => (
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

      <section>
        <p className="tape">Also on this network</p>
        <div className="grid-3 cols-3" style={{ marginTop: 12 }}>
          {NETWORK_EDGES.map((n) => (
            <article className="panel" key={n.id}>
              <p className="tape">{n.kind}</p>
              <h3>
                <a href={n.href} className="news-link" {...(n.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {n.name}
                </a>
              </h3>
              <p className="mono">{n.host}</p>
              <p className="muted">{n.note}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
