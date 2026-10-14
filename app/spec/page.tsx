import type { Metadata } from "next";
import { DOCUMENT, MEDIA, PROTOCOL, URN } from "@/lib/protocol";

export const metadata: Metadata = { title: "Spec" };
const GRANT_FORM = "hp1.<payload>";

export default function SpecPage() {
  return (
    <main className="main">
      <section>
        <p className="tape">{DOCUMENT} · {URN}</p>
        <h1 className="display">Harbinger: Agent Grant and Notification Protocol</h1>
        <p className="muted">
          HTTP-native. One agent charges another for a ping the instant named prints line up.
          Unpaid callers receive 403. This is not pay-for-a-resource.
        </p>
      </section>
      <section className="grid-3" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <article className="panel"><p className="tape">Designation</p><p className="mono">{PROTOCOL}</p></article>
        <article className="panel"><p className="tape">Status</p><p>403 Forbidden until grant</p></article>
        <article className="panel"><p className="tape">Media</p><p className="mono">{MEDIA}</p></article>
      </section>
      <article className="panel">
        <h2>3. Status-code binding</h2>
        <p className="muted">Harbinger binds to HTTP 403. 401 is authentication. 402 is payment-for-a-resource. Implementations MUST NOT speak HTTP 402 on Harbinger endpoints.</p>
      </article>
      <article className="panel">
        <h2>Status: real-move ping</h2>
        <p className="muted">The stream and hooks wait for a post-start threshold move on the watch&apos;s legs. firedAt is the quote time. One-leg correlation is null. If the window ends with no move, the result is no-move and the grant is not consumed (Nic, 10 Oct 2026). AgentMail send stays paused. Do not pay for that rail.</p>
      </article>
      <article className="panel">
        <h2>4–5. Grants and handshake</h2>
        <p className="muted">A grant is a bearer token of the form <span className="mono">{GRANT_FORM}</span>. Demo grant <span className="mono">hp1.demo</span>.</p>
        <ol className="list">
          <li className="item">GET /v1/stream with X-Harbinger-Watch.</li>
          <li className="item">Edge answers 403 with grant-required, price, event, advantage window.</li>
          <li className="item">Retry with X-Harbinger-Grant.</li>
          <li className="item">202 pending. Poll until one ping, or no-move with the grant unspent.</li>
        </ol>
      </article>
      <article className="panel">
        <h2>14. AgentMail rail</h2>
        <p className="muted">AgentMail is an optional delivery adapter. It is not the protocol. A mailbox API key is not a grant. SSE remains the hot path.</p>
      </article>
    </main>
  );
}
