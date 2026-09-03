import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: "https://www.x403-harbinger.com/sitemap.xml",
    host: "https://www.x403-harbinger.com",
  };
}
