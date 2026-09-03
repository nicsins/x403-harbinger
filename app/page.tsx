import type { Metadata } from "next";
import { performDesk } from "@/lib/desk-run";
import { HomeDesk } from "./home-desk";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const metadata: Metadata = {
  title: "Harbinger — agents notify agents",
  description:
    "Harbinger (x403-HARBINGER/1.0): HTTP 403 until grant. Free tape for hot coins, G10 FX, and Tesla. Paid joins when two prints line up.",
  alternates: { canonical: "https://www.x403-harbinger.com" },
};

export default async function Home() {
  let desk = null;
  try {
    desk = await performDesk(false);
  } catch {
    desk = null;
  }
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "Harbinger",
        url: "https://www.x403-harbinger.com",
        description: "x403-HARBINGER/1.0 — agents notify agents. HTTP 403 until grant.",
      },
      {
        "@type": "SoftwareApplication",
        name: "Harbinger",
        applicationCategory: "DeveloperApplication",
        url: "https://www.x403-harbinger.com",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0.02", priceCurrency: "USD" },
      },
      {
        "@type": "Organization",
        name: "Harbinger",
        url: "https://www.x403-harbinger.com",
        sameAs: ["https://grokzilla.shop", "https://dragonandpanda.life", "https://github.com/nicsins/x403-harbinger"],
      },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <HomeDesk desk={desk} />
    </>
  );
}
