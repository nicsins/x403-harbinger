/** Server-only RSS briefs. Relevant to the desk, not a take. */

export type Brief = {
  title: string;
  href: string;
  source: string;
  published: string | null;
};

const FEEDS: { source: string; url: string }[] = [
  {
    source: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  {
    source: "Yahoo Finance",
    url: "https://finance.yahoo.com/news/rssindex",
  },
  {
    source: "Google News",
    url: "https://news.google.com/rss/search?q=Tesla+OR+SpaceX+OR+xAI+OR+bitcoin+OR+%22AI+agent%22&hl=en-US&gl=US&ceid=US:en",
  },
];

const UA = "Mozilla/5.0 (compatible; HarbingerAgency/1.0; +https://www.x403-harbinger.com)";

function decode(s: string) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function tag(block: string, name: string) {
  const m =
    block.match(new RegExp(`<${name}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>`, "i")) ??
    block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m?.[1] ? decode(m[1]) : "";
}

function parseRss(xml: string, source: string): Brief[] {
  const parts = xml.split(/<item[\s>]/i).slice(1);
  const out: Brief[] = [];
  for (const raw of parts.slice(0, 8)) {
    const title = tag(raw, "title");
    let href = tag(raw, "link");
    if (!href) {
      const alt = raw.match(/href="([^"]+)"/i);
      href = alt?.[1] ?? "";
    }
    if (!title || !href) continue;
    const published = tag(raw, "pubDate") || tag(raw, "published") || null;
    out.push({ title, href, source, published });
  }
  return out;
}

async function pull(url: string) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`rss ${res.status}`);
  return res.text();
}

export async function fetchBriefs(limit = 8): Promise<Brief[]> {
  const bags = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        return parseRss(await pull(f.url), f.source);
      } catch {
        return [] as Brief[];
      }
    }),
  );
  const seen = new Set<string>();
  const merged: Brief[] = [];
  for (const bag of bags) {
    for (const b of bag) {
      const key = b.title.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(b);
    }
  }
  return merged.slice(0, limit);
}
