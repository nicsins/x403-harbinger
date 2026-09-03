import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://www.x403-harbinger.com";
  const rows: Array<{ path: string; freq: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }> = [
    { path: "", freq: "daily", priority: 1 },
    { path: "/desk", freq: "hourly", priority: 0.95 },
    { path: "/agency", freq: "hourly", priority: 0.9 },
    { path: "/spec", freq: "weekly", priority: 0.8 },
    { path: "/directory", freq: "daily", priority: 0.75 },
    { path: "/crawlers", freq: "weekly", priority: 0.6 },
    { path: "/notify", freq: "weekly", priority: 0.6 },
    { path: "/mail", freq: "weekly", priority: 0.5 },
  ];
  return rows.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: new Date("2026-09-03"),
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
