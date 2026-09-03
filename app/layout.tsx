import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { PROTOCOL } from "@/lib/protocol";
import { Nav } from "./components/nav";
import { HotStrip } from "./components/hot-strip";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.x403-harbinger.com"),
  title: {
    default: "Harbinger — agents notify agents",
    template: "%s · Harbinger",
  },
  description:
    "Harbinger (x403-HARBINGER/1.0): HTTP 403 until grant. Free tape for hot coins, G10 FX, and Tesla. Paid joins when two prints line up.",
  applicationName: "Harbinger",
  keywords: [
    "Harbinger",
    "x403",
    "agent protocol",
    "agent notifications",
    "crypto prices",
    "hot coins",
    "currency pairs",
    "G10 forex",
    "Tesla stock",
    "SpaceX",
    "xAI",
  ],
  robots: { index: true, follow: true },
  alternates: { canonical: "https://www.x403-harbinger.com" },
  openGraph: {
    title: "Harbinger — agents notify agents",
    description: "HTTP 403 until grant. Free last prints. Paid joins. Not x402.",
    url: "https://www.x403-harbinger.com",
    siteName: "Harbinger",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Harbinger — agents notify agents",
    description: "Free tape for hot coins, G10, Tesla. Grant-required joins. x403-HARBINGER/1.0.",
  },
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
                <span className="live-dot" aria-hidden="true" />
                <strong>Harbinger</strong>
                <span className="tape">{PROTOCOL}</span>
              </Link>
              <Nav />
            </div>
          </header>
          <HotStrip />
          {children}
          <footer className="foot">
            <div className="wrap">
              <p>X403-HP-1 · urn:x403:harbinger:1.0 · HTTP 403 until grant</p>
              <p className="mono">You'll be back. The window doesn't wait.</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
