import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { PROTOCOL } from "@/lib/protocol";
import { Nav } from "./components/nav";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.x403-harbinger.com"),
  title: {
    default: "Harbinger",
    template: "%s · Harbinger",
  },
  description: "Harbinger (x403-HARBINGER/1.0) — agents notify agents. HTTP 403 until grant.",
  applicationName: "Harbinger",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://www.x403-harbinger.com" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="bar">
            <div className="wrap">
              <Link href="/" className="brand">
                <strong>Harbinger</strong>
                <span className="tape">{PROTOCOL}</span>
              </Link>
              <Nav />
            </div>
          </header>
          {children}
          <footer className="foot">
            <div className="wrap">
              <p>X403-HP-1 · urn:x403:harbinger:1.0 · HTTP 403 until grant</p>
              <p className="mono">AgentMail is a rail. Not the protocol.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
