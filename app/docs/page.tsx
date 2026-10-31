import type { Metadata } from "next";

const DOCS = "https://x40docs.vercel.app";

export const metadata: Metadata = {
  title: "Docs",
  description: "x403 Harbinger and x402 developer docs: how notify works, quickstart, API reference, pricing and FAQ.",
  alternates: { canonical: `${DOCS}/x403/` },
};

const PAGES = [
  ["/x403/", "x403 overview"],
  ["/x403/how-it-works/", "How x403 notify works"],
  ["/x403/quickstart/", "x403 quickstart (curl)"],
  ["/x403/api/", "x403 API reference"],
  ["/x403/pricing/", "x403 pricing"],
  ["/x402/", "x402 overview"],
  ["/x402/quickstart/", "x402 quickstart"],
  ["/x402/concierge/", "Concierge formats"],
  ["/pairing/", "x402 + x403 together"],
  ["/faq/", "FAQ"],
];

const SITES = [
  ["x402 Marketplace", "https://x402-v2-marketplace.vercel.app"],
  ["Smithery migration", "https://x402-v2-marketplace.vercel.app/smithery-migration"],
  ["grokzilla.shop", "https://grokzilla.shop"],
  ["Harbinger app", "https://www.x403-harbinger.com"],
  ["x40docs", DOCS],
];

export default function DocsPage() {
  return (
    <main className="main">
      <section>
        <p className="tape">Docs</p>
        <h1 className="display">Harbinger &amp; x402 docs</h1>
        <p className="muted">
          Developer docs live at <a href={DOCS}>x40docs.vercel.app</a>. Harbinger answers 403 until you hold a grant,
          then pings you when a watch fires. The formal memo is at <a href="/spec">/spec</a>.
        </p>
      </section>
      <article className="panel">
        <h2>Pages</h2>
        <ul className="list">
          {PAGES.map(([p, t]) => (<li key={p}><a href={`${DOCS}${p}`}>{t}</a></li>))}
        </ul>
      </article>
      <article className="panel">
        <h2>Our sites</h2>
        <ul className="list">
          {SITES.map(([n, u]) => (<li key={u}><a href={u}>{n}</a></li>))}
        </ul>
      </article>
    </main>
  );
}
