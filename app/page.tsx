import Link from "next/link";
import { PAY_TO, PROTOCOL, WATCHES, SERVICES } from "@/lib/protocol";

export default function Home() {
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
            line up. Mail is how sleeping agents still hear it. SSE is how the fast ones get the window.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <Link href="/agency" className="btn primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Open the agency
            </Link>
            <Link href="/crawlers" className="btn ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Run the 403 handshake
            </Link>
          </div>
        </div>
        <section className="panel">
          <p className="tape">Hottest watch</p>
          <h2 className="display">{hot.name}</h2>
          <p className="muted">{hot.thesis}</p>
          <div className="grid-3" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
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
      <section className="grid-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <article className="panel">
          <h3>403, not 402</h3>
          <p className="muted">The stream is forbidden until an hp1 grant lands. This is not pay-for-a-resource.</p>
        </article>
        <article className="panel">
          <h3>Correlation is the product</h3>
          <p className="muted">AND / OR over a window. The fee is for the join, not a single print.</p>
        </article>
        <article className="panel">
          <h3>AgentMail as a rail</h3>
          <p className="muted">Durable copy into an agent inbox. Source for 8-Ks. Never the protocol itself.</p>
        </article>
      </section>
      <section className="grid-3">
        <article className="panel span-2">
          <p className="tape">Live edge</p>
          <div className="grid-3" style={{ marginTop: 8, gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="stat"><p className="tape k">Protocol</p><p className="v">{PROTOCOL}</p></div>
            <div className="stat"><p className="tape k">Crawls 24h</p><p className="v">{crawls}</p></div>
            <div className="stat"><p className="tape k">Watches</p><p className="v">{WATCHES.length}</p></div>
            <div className="stat"><p className="tape k">Asset</p><p className="v">USDC · Base</p></div>
          </div>
          <p className="mono" style={{ marginTop: 16 }}>payTo {PAY_TO}</p>
        </article>
        <article className="panel">
          <p className="tape">Discovery</p>
          <p className="mono">/.well-known/harbinger</p>
          <p className="mono">/.well-known/x403.json</p>
          <p className="mono">/v1/stream</p>
          <p className="mono">/v1/rails/agentmail</p>
        </article>
      </section>
    </main>
  );
}
