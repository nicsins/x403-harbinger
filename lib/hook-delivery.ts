/**
 * Webhook callback checks and signing.
 *
 * Registration accepts https URLs only and rejects loopback, link-local,
 * private, and metadata hosts. Delivery resolves DNS and refuses the POST if
 * any answer is private (DNS rebinding). Redirects are not followed.
 * The body is HMAC-SHA256 with a per-subscription secret returned at register.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";

const MAX_URL = 500;

export function newHookSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(secret: string, body: string, header: string): boolean {
  const a = Buffer.from(signBody(secret, body));
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isPrivateAddress(ip: string): boolean {
  const raw = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (raw === "::1" || raw === "::") return true;
  if (raw.startsWith("fe80:")) return true;
  if (raw.startsWith("fc") || raw.startsWith("fd")) return true;
  return false;
}

export function validateCallbackUrl(raw: unknown): { ok: true; href: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) {
    return { ok: false, reason: "callback-invalid" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "callback-invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https-required" };
  if (url.username || url.password) return { ok: false, reason: "userinfo" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) {
    return { ok: false, reason: "host" };
  }
  if (host === "metadata.google.internal" || host === "169.254.169.254") return { ok: false, reason: "metadata" };
  if (isPrivateAddress(host)) return { ok: false, reason: "private-ip" };
  return { ok: true, href: url.href };
}

export type DnsLookup = (host: string) => Promise<string[]>;

let testLookup: DnsLookup | null = null;

/** Tests only. Pass null to restore system DNS. */
export function setDnsLookupForTests(fn: DnsLookup | null): void {
  testLookup = fn;
}

export async function resolveCallbackHosts(host: string): Promise<string[]> {
  if (testLookup) return testLookup(host);
  const rows = await dnsLookup(host, { all: true });
  return rows.map((r) => r.address);
}

/** True when every resolved address is public. Empty or mixed answers are unsafe. */
export async function callbackIsPublic(href: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return { ok: false, reason: "callback-invalid" };
  }
  if (isPrivateAddress(host)) return { ok: false, reason: "private-ip" };
  try {
    const addrs = await resolveCallbackHosts(host);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a))) return { ok: false, reason: "ssrf" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "dns" };
  }
}
