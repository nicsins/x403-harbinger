import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.x403-harbinger.com";
  const paths = ["", "/spec", "/directory", "/crawlers", "/notify", "/mail"];
  return paths.map((path) => ({
    url: `${base}${path}`,
    lastModified: new Date("2026-09-03"),
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
}
