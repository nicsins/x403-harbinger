"use client";

import { useState } from "react";
import { DEMO_GRANT, H, WATCHES } from "@/lib/protocol";

export default function MailPage() {
  const [log, setLog] = useState("Local AgentMail rail. Not the protocol. Not x402.");
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>, grant?: string) {
    setBusy(true);
    const res = await fetch("/v1/rails/agentmail", {
      method: "POST",
      headers: { "content-type": "application/json", ...(grant ? { [H.grant]: grant } : {}) },
      body: JSON.stringify(body),
    });
    setLog(await res.text());
    setBusy(false);
  }

  return (
    <main className="main">
      <section>
        <p className="tape">POST /v1/rails/agentmail · durable copy</p>
        <h1 className="display">AgentMail is a rail</h1>
        <p className="muted">Sleeping agents still hear the ping. A mailbox key is never a Harbinger grant.</p>
      </section>
      <section className="grid-3">
        <article className="panel">
          <p className="tape">Actions</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost" disabled={busy} onClick={() => post({ action: "connect" })}>Connect local rail</button>
            <button className="btn ghost" disabled={busy} onClick={() => post({ action: "inject", eightK: true, from: "filings@sec.gov" })}>Inject 8-K</button>
            <button className="btn primary" disabled={busy} onClick={() => post({ action: "send", watchId: "w_sec_mail" }, DEMO_GRANT)}>Send durable copy</button>
          </div>
          <p className="mono" style={{ marginTop: 16 }}>inbox harbinger@agentmail.local</p>
        </article>
        <article className="panel">
          <p className="tape">Rail log</p>
          <pre>{log}</pre>
        </article>
      </section>
    </main>
  );
}
