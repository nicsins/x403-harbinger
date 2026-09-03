"use client";

import Link from "next/link";
import { ReturnHook } from "./components/return-hook";
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
      <section className="grid-3 rise">
        <div>
          <p className="tape">live · x403-harbinger/1.0 · 403 until grant</p>
          <h1 className="display">The tape is already moving. Forbidden until grant.</h1>
          <p className="muted">
            Last print is a taste. The join is the hit you come back for. Stay long enough and this desk
            starts to feel like yours — hot coins, G10, Tesla ticking while the paid window stays locked.
          </p>
          <div style={{ marginTop: 16 }}>
            <ReturnHook />
          </div>
          <div className="row" style={{ marginTop: 20 }}>
            <Link href="/desk" className="btn primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Stay on the tape
            </Link>
            <Link href="/agency" className="btn ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Pay for the join
            </Link>
          </div>
        </div>
        <section className="panel want">
          <p className="tape">the one they wait for</p>
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
            <span className="pill danger">403 until hp1</span>
          </div>
        </section>
      </section>

      <section className="rise rise-2">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <p className="tape">Free tape · no grant · variable reward</p>
          <Link href="/desk" className="mono">Full desk</Link>
        </div>
        <div className="grid-3 cols-3" style={{ marginTop: 12 }}>
          {(desk?.freePings ?? []).map((p) => (
            <article className="panel" key={p.id}>
              <p className="tape">free · {p.id}</p>
              <h3>{p.name}</h3>
              <p className={`ping-stat ${pctClass(p.pct)}`}>{p.label}</p>
            </article>
          ))}
          {!desk ? (
            <article className="panel">
              <p className="muted">The next print is loading…</p>
            </article>
          ) : null}
        </div>
      </section>

      <section className="grid-3 rise rise-3">
        <article className="panel span-2">
          <p className="tape">Briefs · keep the loop going</p>
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
        <article className="lock-rail">
          <p className="tape">curiosity gap</p>
          <h3 className="display" style={{ fontSize: 22 }}>403 is the tease. hp1 is the close.</h3>
          <p className="muted">
            Discovery is public on purpose. The join stays forbidden so the grant still means something.
            {crawls.toLocaleString()} crawls already knocked. The window is {hot.advantageMs}ms.
          </p>
          <p className="mono" style={{ marginTop: 16 }}>payTo {PAY_TO}</p>
          <p className="mono">{PROTOCOL}</p>
          <p className="mono">/v1/tape · /v1/stream · /llms.txt</p>
        </article>
      </section>

      <section id="feeds" className="rise rise-4">
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
        <p className="tape">Also on this network · stay in the family</p>
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
