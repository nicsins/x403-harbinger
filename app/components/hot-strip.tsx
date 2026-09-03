"use client";

import { useEffect, useState } from "react";

type Ping = { label?: string; pct?: number | null };
type Mover = { name?: string; pct1d?: number | null };

function fmt(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

const FALLBACK = [
  "Last print is free",
  "The join is still 403",
  "Come back — the tape does not sleep",
];

export function HotStrip() {
  const [items, setItems] = useState<string[]>(FALLBACK);

  useEffect(() => {
    let live = true;
    fetch("/v1/tape")
      .then((r) => r.json())
      .then((d: { freePings?: Ping[]; movers?: Mover[] }) => {
        if (!live) return;
        const bits: string[] = [];
        for (const p of d.freePings ?? []) if (p.label) bits.push(p.label);
        for (const m of (d.movers ?? []).slice(0, 5)) {
          if (m.name && m.pct1d != null) bits.push(`${m.name} ${fmt(m.pct1d)} / 1d`);
        }
        if (bits.length) setItems([...bits, "Last print is free · the join is the hit"]);
      })
      .catch(() => {
        /* keep fallback copy */
      });
    return () => {
      live = false;
    };
  }, []);

  const padded = [...items];
  while (padded.length < 10) padded.push(...items);
  const loop = [...padded, ...padded];
  return (
    <div className="hotstrip" aria-label="Live tape">
      <span className="live-dot" aria-hidden="true" />
      <span className="hotstrip-label">Live</span>
      <div className="hotstrip-mask">
        <div className="hotstrip-track" key={items.join("|")}>
          {loop.map((t, i) => (
            <span key={`${t}-${i}`}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
