"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DEMO_GRANT, H } from "@/lib/protocol";
import { HORIZONS, INSTRUMENTS, SWARM, WATCH_BOOK, type Lane } from "@/lib/agency";
import type { Notable, PairRow, TapeRow, WatchRow } from "@/lib/score";

type Snap = {
  ranAt: string | null;
  note: string;
  tape: TapeRow[];
  watches: WatchRow[];
  pairs: PairRow[];
  notables: Notable[];
  firedCount: number;
  liveCount: number;
};

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

function catalogSnap(): Snap {
  return {
    ranAt: null,
    note: "Catalog loaded. Run a patrol to pull the 7-day tape.",
    tape: INSTRUMENTS.map((i) => ({
      id: i.id,
      klass: i.klass,
      name: i.name,
      symbol: i.symbol,
      last: null,
      pct1h: null,
      pct4h: null,
      pct1d: null,
      hit1h10: null,
      ok: false,
    })),
    watches: WATCH_BOOK.map((w) => ({
      id: w.id,
      name: w.name,
      thesis: w.thesis,
      logic: w.logic,
      windowMinutes: w.windowMinutes,
      advantageMs: w.advantageMs,
      priceUsdc: w.priceUsdc,
      billing: w.billing,
      deliveries: w.deliveries,
      hot: Boolean(w.hot),
      fired: false,
      score: 0,
      event: w.legs.map((l) => l.event).join(w.logic === "all" ? "+" : "|"),
      legs: w.legs.map((l) => ({ ...l, pct: null, matched: false, hitRate7d: null })),
    })),
    pairs: [],
    notables: [],
    firedCount: 0,
    liveCount: 0,
  };
}

export function Desk() {
  const [snap, setSnap] = useState<Snap>(catalogSnap);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [klass, setKlass] = useState<"all" | "crypto" | "forex" | "equity">("all");
  const [onlyFired, setOnlyFired] = useState(false);
  const [ping, setPing] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/v1/agency")
      .then((r) => r.json())
      .then((body: { lastPatrol?: Snap | null }) => {
        if (live && body.lastPatrol?.tape?.length) setSnap(body.lastPatrol);
      })
      .catch(() => {
        /* catalog already on screen */
      });
    return () => {
      live = false;
    };
  }, []);

  async function patrol() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/v1/patrol", {
        method: "POST",
        headers: { [H.grant]: DEMO_GRANT },
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(typeof body?.meaning === "string" ? body.meaning : `HTTP ${res.status}`);
        return;
      }
      setSnap({
        ranAt: body.ranAt ?? null,
        note: body.note ?? "Patrol complete.",
        tape: body.tape ?? [],
        watches: (body.watches ?? []).map((w: WatchRow) => {
          const book = WATCH_BOOK.find((b) => b.id === w.id);
          return {
            ...book,
            ...w,
            thesis: book?.thesis ?? "",
            deliveries: book?.deliveries ?? [],
            billing: book?.billing ?? "per-ping",
            windowMinutes: book?.windowMinutes ?? 60,
            advantageMs: book?.advantageMs ?? 0,
            priceUsdc: book?.priceUsdc ?? 0,
            logic: book?.logic ?? "any",
            hot: Boolean(book?.hot),
            legs: w.legs ?? book?.legs.map((l) => ({ ...l, pct: null, matched: false, hitRate7d: null })) ?? [],
          };
        }),
        pairs: (body.pairs ?? []).map((p: PairRow) => {
          const a = INSTRUMENTS.find((i) => i.id === p.a);
          const b = INSTRUMENTS.find((i) => i.id === p.b);
          return { ...p, nameA: a?.name ?? p.a, nameB: b?.name ?? p.b, thesis: p.thesis ?? "", windowMinutes: p.windowMinutes ?? 60 };
        }),
        notables: body.notables ?? [],
        firedCount: body.fired ?? 0,
        liveCount: body.live ?? 0,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Patrol failed");
    } finally {
      setBusy(false);
    }
  }

  async function pingWatch(id: string) {
    const res = await fetch(`/v1/stream?watch=${encodeURIComponent(id)}`, {
      headers: { [H.grant]: DEMO_GRANT, [H.watch]: id },
    });
    setPing(await res.text());
  }

  const tape = useMemo(() => {
    return klass === "all" ? snap.tape : snap.tape.filter((r) => r.klass === klass);
  }, [snap, klass]);
  const book = useMemo(() => (onlyFired ? snap.watches.filter((w) => w.fired) : snap.watches), [snap, onlyFired]);

  return (
    <main className="main">
      <section className="grid-3">
        <div>
          <p className="tape">agency · swarm · persistent book</p>
          <h1 className="display">The swarm watches the tape. The join is what you buy.</h1>
          <p className="muted">
            A durable catalog of notification watches. Scouts pull live hour bars across crypto, G10, and
            equities. The joiner fires only when named percent moves line up inside a window. Herald still
            answers 403 until an hp1 grant. Correlation scores are estimates, not investment advice.
          </p>
          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn primary" disabled={busy} onClick={() => void patrol()}>
              {busy ? "Patrolling…" : "Run a patrol"}
            </button>
            <Link href="/notify" className="btn ghost" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Settle a ping
            </Link>
          </div>
        </div>
        <section className="panel">
          <p className="tape">Live edge</p>
          <div className="grid-3 cols-2" style={{ marginTop: 8 }}>
            <div className="stat"><p className="tape k">Prints live</p><p className="v">{snap.liveCount} / {snap.tape.length}</p></div>
            <div className="stat"><p className="tape k">Watches fired</p><p className="v">{snap.firedCount}</p></div>
            <div className="stat"><p className="tape k">Notables</p><p className="v">{snap.notables.length}</p></div>
            <div className="stat"><p className="tape k">Pairs</p><p className="v">{snap.pairs.length}</p></div>
          </div>
          <p className="mono" style={{ marginTop: 16 }}>{busy ? "Pulling 7-day hour bars…" : snap.note}</p>
          {err ? <p className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</p> : null}
        </section>
      </section>

      <section className="grid-3 cols-4">
        {HORIZONS.map((h: { lane: Lane; title: string; note: string }) => (
          <article className="panel" key={h.lane}>
            <p className="tape">{h.lane === "finance" ? "live" : "reserved"}</p>
            <h3>{h.title}</h3>
            <p className="muted">{h.note}</p>
          </article>
        ))}
      </section>

      {snap.notables.length ? (
        <section className="panel">
          <p className="tape">Notables · auto-detected from the 7-day tape</p>
          <ul className="list">
            {snap.notables.map((n) => (
              <li className="item" key={n.id}>
                <span className={n.pct > 0 ? "pill ok" : "pill danger"}>{n.label}</span>{" "}
                <span className="mono">{n.name} · {n.window}</span>
                <span className={`mono ${pctClass(n.pct)}`}> · {fmtPct(n.pct)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {snap.pairs.length ? (
        <section className="panel">
          <p className="tape">Joiner · rolling Pearson on hour returns</p>
          <div className="table-wrap">
            <table className="tape-table">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Window</th>
                  <th>ρ</th>
                  <th>n</th>
                  <th>Thesis</th>
                </tr>
              </thead>
              <tbody>
                {snap.pairs.map((p) => (
                  <tr key={`${p.a}-${p.b}`}>
                    <td>
                      {p.nameA} / {p.nameB}
                      <div className="mono">{p.a} · {p.b}</div>
                    </td>
                    <td className="mono">{p.windowMinutes}m</td>
                    <td className={`mono ${p.rho != null && p.rho < 0 ? "num-down" : "num-up"}`}>
                      {p.rho == null ? "—" : p.rho.toFixed(2)}
                    </td>
                    <td className="mono">{p.samples}</td>
                    <td className="muted">{p.thesis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <p className="tape">Tape · 1h / 4h / 1d</p>
          <div className="row">
            {(["all", "crypto", "forex", "equity"] as const).map((k) => (
              <button key={k} className="btn ghost" disabled={klass === k} onClick={() => setKlass(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="tape-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Class</th>
                <th>Last</th>
                <th>1h</th>
                <th>4h</th>
                <th>1d</th>
                <th>10%/1h hit 7d</th>
              </tr>
            </thead>
            <tbody>
              {tape.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <div className="mono">{row.symbol}</div>
                  </td>
                  <td className="mono">{row.klass}</td>
                  <td className="mono">{fmtPx(row.last)}</td>
                  <td className={`mono ${pctClass(row.pct1h)}`}>{fmtPct(row.pct1h)}</td>
                  <td className={`mono ${pctClass(row.pct4h)}`}>{fmtPct(row.pct4h)}</td>
                  <td className={`mono ${pctClass(row.pct1d)}`}>{fmtPct(row.pct1d)}</td>
                  <td>
                    <div className="hitbar">
                      <span style={{ width: `${Math.min(100, (row.hit1h10 ?? 0) * 100)}%` }} />
                    </div>
                    <span className="mono">{row.hit1h10 == null ? "—" : `${(row.hit1h10 * 100).toFixed(1)}%`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <p className="tape">Watch book · grant-required notify</p>
          <button className="btn ghost" onClick={() => setOnlyFired(!onlyFired)}>
            {onlyFired ? "Show all" : "Fired only"}
          </button>
        </div>
        <div className="grid-3" style={{ marginTop: 12 }}>
          {book.map((w) => (
            <article className={`panel${w.hot ? " span-2" : ""}`} key={w.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <p className="tape">{w.id}{w.hot ? " · hot" : ""}</p>
                <span className={w.fired ? "pill ok" : "pill"}>{w.fired ? "fired" : "quiet"}</span>
              </div>
              <h2>{w.name}</h2>
              <p className="muted">{w.thesis}</p>
              <div className="row" style={{ marginTop: 12 }}>
                <span className="pill">{w.logic.toUpperCase()}</span>
                <span className="pill">{w.windowMinutes}m</span>
                <span className="pill">{w.priceUsdc} USDC</span>
                <span className="pill">ρ {w.score.toFixed(2)}</span>
              </div>
              <ul className="list">
                {w.legs.map((l) => (
                  <li className="item" key={l.id}>
                    <span className={l.matched ? "pill ok" : "pill"}>{l.matched ? "in" : "out"}</span>{" "}
                    <span className="mono">{l.label}</span>
                    <span className={`mono ${pctClass(l.pct)}`}> · {fmtPct(l.pct)}</span>
                  </li>
                ))}
              </ul>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={() => void pingWatch(w.id)}>
                  Grant {DEMO_GRANT}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid-3">
        <article className="panel">
          <p className="tape">Swarm</p>
          <ul className="list">
            {SWARM.map((a) => (
              <li className="item" key={a.id}>
                <span className="mono">{a.id}</span>
                <p className="muted" style={{ margin: "4px 0 0" }}>{a.beat}</p>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <p className="tape">Last ping</p>
          <p className="muted">Discovery is public. The stream is forbidden until hp1.</p>
          {ping ? <pre style={{ marginTop: 12 }}>{ping}</pre> : <p className="mono" style={{ marginTop: 12 }}>No grant yet.</p>}
        </article>
      </section>
    </main>
  );
}
