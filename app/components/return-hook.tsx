"use client";

import { useEffect, useState } from "react";

export function ReturnHook() {
  const [line, setLine] = useState("The tape is live. Stay a minute.");

  useEffect(() => {
    try {
      const n = Number(localStorage.getItem("hb.visits") || "0") + 1;
      localStorage.setItem("hb.visits", String(Math.min(n, 9999)));
      if (n === 1) setLine("First print. The next one is why people stay.");
      else if (n === 2) setLine("You're back. That's how a desk becomes a habit.");
      else setLine(`You're back. That's ${n} times you've watched the tape.`);
    } catch {
      /* private mode — still welcome them */
    }
  }, []);

  return <p className="return-hook">{line}</p>;
}
