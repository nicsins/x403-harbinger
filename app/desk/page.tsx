import type { Metadata } from "next";
import { performDesk } from "@/lib/desk-run";
import { Board } from "./board";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const metadata: Metadata = {
  title: "Free tape",
  description:
    "Free Harbinger desk: hot-coin prints, highest-moving G10 pairs, Tesla live, SpaceX and xAI marks, market briefs and live news video. Joins still 403 until grant.",
  alternates: { canonical: "https://www.x403-harbinger.com/desk" },
  keywords: [
    "crypto prices",
    "hot coins",
    "currency pairs",
    "G10 forex",
    "Tesla stock",
    "SpaceX valuation",
    "xAI",
    "Harbinger",
    "x403",
  ],
  openGraph: {
    title: "Free tape · Harbinger",
    description: "Hot coins, G10 FX, Tesla live. SpaceX and xAI as last-reported marks. Last print is free.",
    url: "https://www.x403-harbinger.com/desk",
    type: "website",
  },
};

export default async function DeskPage() {
  const snap = await performDesk(false);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Harbinger free tape",
    url: "https://www.x403-harbinger.com/desk",
    description:
      "Free last prints for hot coins, G10 FX, and Tesla. SpaceX and xAI as last reported marks. News briefs and live video.",
    isPartOf: { "@type": "WebSite", name: "Harbinger", url: "https://www.x403-harbinger.com" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Board initial={snap} />
    </>
  );
}
