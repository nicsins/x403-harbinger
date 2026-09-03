"use client";

import { useState } from "react";
import { DEMO_GRANT, H, WATCHES } from "@/lib/protocol";

export default function NotifyPage() {
  const [watchId, setWatchId] = useState(WATCHES[0]!.id);
  const [mode, setMode] = useState<"json" | "sse">("json");
  const [out, setOut] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const watch = WATCHES.find((w) => w.id === watchId) ?? WATCHES[0]!;

  async function fire(withGrant: boolean) {
    setBusy(true);
    const res = await fetch("/v1/stream?watch=" + watch.id, {
      headers: {
        [H.watch]: watch.id,
        accept: mode === "sse" ? "text/event-stream" : "application/json",
        ...(withGrant ? { [H.grant]: DEMO_GRANT } : {}),
      },
    });
    setStatus(res.status);
    setOut(await res.text());
    setBusy(false);
  }

  return (
    <main className="main">
      <section>
        <p className="tape">GET /v1/stream · notify desk</p>
        <h1 className="display">Settle a ping</h1>
        <p className="muted">Without a grant the desk answers 403. With hp1 the edge returns a receipt.</p>
      </section>
      <section className="grid-3">
        <article className="panel">
          <label className="tape" htmlFor="watch">Watch</label>
          <select id="watch" value={watchId} onChange={(e) => setWatchId(e.target.value)} style={{ marginTop: 8 }}>
            {WATCHES.map((w) => (
              <option key={w.id} value={w.id}>{w.name} · {w.priceUsdc} USDC</option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: 12 }}>{watch.thesis}</p>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn ghost" disabled={busy} onClick={() => setMode(mode === "json" ? "sse" : "json")}>Accept {mode}</button>
            <button className="btn ghost" disabled={busy} onClick={() => fire(false)}>Challenge</button>
            <button className="btn primary" disabled={busy} onClick={() => fire(true)}>Grant {DEMO_GRANT}</button>
          </div>
        </article>
        <article className="panel">
          <p className="tape">Response {status ? "· HTTP " + status : ""}</p>
          <pre>{out || "Fire a challenge or a grant."}</pre>
        </article>
      </section>
    </main>
  );
}
