"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Protocol" },
  { href: "/desk", label: "Desk" },
  { href: "/agency", label: "Agency" },
  { href: "/spec", label: "Spec" },
  { href: "/directory", label: "Directory" },
  { href: "/crawlers", label: "Crawlers" },
  { href: "/notify", label: "Notify" },
  { href: "/mail", label: "Mail rail" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={path === n.href ? "on" : ""}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
