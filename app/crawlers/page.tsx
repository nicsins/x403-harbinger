"use client";

import { useState } from "react";
import { DEMO_GRANT, H } from "@/lib/protocol";

type Shot = { status: number; body: string };

async function shot(path: string, init?: RequestInit): Promise<Shot> {
  const res = await fetch(path, init);
  return { status: res.status, body: await res.text() };
}

export default function CrawlersPage() {
  const [discover, setDiscover] = useState<Shot | null>(null);
  const [tape, setTape] = useState<Shot | null>(null);
  const [forbidden, setForbidden] = useState<Shot | null>(null);
  const [granted, setGranted] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setDiscover(await shot("/.well-known/harbinger"));
    setTape(await shot("/v1/tape", { headers: { [H.crawl]: "1" } }));
    setForbidden(await shot("/v1/stream?watch=w_eth_funding", { headers: { [H.crawl]: "1" } }));
    setGranted(await shot("/v1/stream?watch=w_eth_funding", { headers: { [H.crawl]: "1", [H.grant]: DEMO_GRANT } }));
    setBusy(false);
  }

  return (
    <main className="main">
      <section>
        <p className="tape">X-Harbinger-Crawl</p>
        <h1 className="display">Run the 403 handshake</h1>
        <p className="muted">Discovery and the free tape are public. The stream is forbidden until an hp1 grant lands.</p>
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn primary" disabled={busy} onClick={run}>
            {busy ? "Speaking the wire" : "Discover, 403, then grant"}
          </button>
        </div>
      </section>
      <Card title="1  /.well-known/harbinger" shot={discover} expect={200} />
      <Card title="2  GET /v1/tape — free, even with crawl flag" shot={tape} expect={200} />
      <Card title="3  GET /v1/stream without grant" shot={forbidden} expect={403} />
      <Card title={"4  retry with " + DEMO_GRANT} shot={granted} expect={200} />
    </main>
  );
}

function Card(props: { title: string; shot: Shot | null; expect: number }) {
  const ok = props.shot ? props.shot.status === props.expect : null;
  const badgeClass = ok ? "pill ok" : "pill danger";
  return (
    <article className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="tape">{props.title}</p>
        {props.shot ? <span className={badgeClass}>HTTP {props.shot.status}</span> : <span className="pill">waiting</span>}
      </div>
      {props.shot ? <pre style={{ marginTop: 12 }}>{props.shot.body}</pre> : <p className="muted">Run the handshake to fill this frame.</p>}
    </article>
  );
}
