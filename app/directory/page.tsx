import type { Metadata } from "next";
import { PAY_TO, SERVICES, WATCHES } from "@/lib/protocol";

export const metadata: Metadata = {
  title: "Directory",
  description: "Listed Harbinger edges: free tape, agency catalog, Grokzilla.shop, Dragon and Panda, AgentMail rail.",
  alternates: { canonical: "https://www.x403-harbinger.com/directory" },
};

export default function DirectoryPage() {
  return (
    <main className="main">
      <section>
        <p className="tape">GET /v1/index · GET /v1/watches · GET /v1/agency · GET /v1/tape</p>
        <h1 className="display">Listed edges and watches</h1>
        <p className="muted">
          Crawlers index these paths. Discovery is public. The free tape needs no grant. The stream is
          forbidden until grant. The agency book is the durable catalog the swarm patrols. Grokzilla and
          Dragon and Panda sit on the same directory so agents can find the rest of the network.
        </p>
        <p className="mono" style={{ marginTop: 12 }}>payTo {PAY_TO}</p>
      </section>
      <section className="grid-3 cols-3">
        {SERVICES.map((s) => (
          <article className="panel" key={s.id}>
            <p className="tape">{s.kind}</p>
            <h2>{s.name}</h2>
            <p className="mono">{s.host}{s.path}</p>
            <p className="muted">{s.note}</p>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="pill">{s.price}</span>
              <span className="pill">{s.crawls24h} crawls / 24h</span>
            </div>
          </article>
        ))}
      </section>
      <section className="grid-3">
        {WATCHES.map((w) => (
          <article className={`panel${w.hot ? " span-2" : ""}`} key={w.id}>
            <p className="tape">{w.id}{w.hot ? " · hot" : ""}</p>
            <h2>{w.name}</h2>
            <p className="muted">{w.thesis}</p>
            <div className="row" style={{ marginTop: 12 }}>
              <span className="pill">{w.priceUsdc} USDC · {w.billing}</span>
              <span className="pill">{w.logic.toUpperCase()} · {w.windowMs / 1000}s</span>
              <span className="pill">{w.advantageMs}ms lead</span>
              {w.deliveries.map((d) => (
                <span className="pill ok" key={d}>{d}</span>
              ))}
            </div>
            <ul className="list">
              {w.conditions.map((c) => (
                <li className="item" key={c.id}>
                  <span className="mono">{c.event}</span>
                  <span className="muted"> · {c.label} · {c.source}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
