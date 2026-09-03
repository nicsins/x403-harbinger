import type { Metadata } from "next";
import { Desk } from "./desk";

export const metadata: Metadata = {
  title: "Agency",
  description:
    "Harbinger agency — persistent watch book for crypto, G10 FX, and equities. Percent-move joins over 1h / 4h / 1d. HTTP 403 until grant.",
  alternates: { canonical: "https://www.x403-harbinger.com/agency" },
};

export default function AgencyPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "Harbinger Agency",
    description:
      "Agent swarm catalog of finance notification watches. Crypto, forex, and equity percent-move joins. Grant-required notify over HTTP 403.",
    url: "https://www.x403-harbinger.com/agency",
    documentation: "https://www.x403-harbinger.com/spec",
    provider: { "@type": "Organization", name: "Harbinger", url: "https://www.x403-harbinger.com" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Desk />
    </>
  );
}
