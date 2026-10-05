/** Callback URL checks and delivery signatures for the hook outbox.
 *
 * Registration checks the URL shape and literal hosts. Delivery resolves DNS
 * through guardedLookup, refuses any private answer, and connects to the exact
 * address it checked, so a hostname cannot rebind to an internal IP.
 */
import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";

export type CallbackCheck =
  | { ok: true; url: string }
  | { ok: false; reason: string };

function ipv4Private(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const n = m.slice(1).map((p) => Number(p));
  if (n.some((x) => x > 255)) return true;
  const [a, b] = n as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "metadata.google.internal" || host === "metadata.google") return true;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1" || bare === "::") return true;
  const v6 = bare.toLowerCase();
  if (v6.includes(":") && (v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd"))) return true;
  if (v6.startsWith("::ffff:")) {
    const mapped = v6.slice("::ffff:".length);
    if (ipv4Private(mapped)) return true;
  }
  return ipv4Private(bare);
}

export function validateCallbackUrl(raw: unknown): CallbackCheck {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return { ok: false, reason: "callback-invalid" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "callback-invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "callback-https-required" };
  if (url.username || url.password) return { ok: false, reason: "callback-credentials" };
  if (blockedHost(url.hostname)) return { ok: false, reason: "callback-blocked-host" };
  return { ok: true, url: url.toString() };
}

export function signHookBody(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

export type DeliveryResult = { ok: boolean; status?: number; error?: string };

type LookupAnswer = { address: string; family: number };
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAnswer[], family?: number) => void;
type BaseLookup = (host: string, opts: { all: true }, cb: (err: NodeJS.ErrnoException | null, addrs: LookupAnswer[]) => void) => void;

/** DNS lookup for outbound hooks: every answer must be public, or the connect fails. */
export function guardedLookup(base: BaseLookup = dnsLookup as unknown as BaseLookup) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCb) => {
    base(hostname, { all: true }, (err, addrs) => {
      if (err) return callback(err, "", 0);
      if (!addrs?.length || addrs.some((a) => blockedHost(a.address))) {
        return callback(Object.assign(new Error("callback-blocked-address"), { code: "EHOOKBLOCKED" }), "", 0);
      }
      if (options?.all) return callback(null, addrs);
      callback(null, addrs[0]!.address, addrs[0]!.family);
    });
  };
}

/** POST once over https to a DNS-checked address. Redirects are not followed. */
export function postHook(url: string, body: string, signature: string): Promise<DeliveryResult> {
  return new Promise((resolve) => {
    let req: ReturnType<typeof httpsRequest>;
    try {
      req = httpsRequest(url, {
        method: "POST",
        lookup: guardedLookup() as never,
        timeout: 5000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "HarbingerHook/1.0",
          "X-Harbinger-Signature": signature,
        },
      });
    } catch (err) {
      return resolve({ ok: false, error: err instanceof Error ? err.message : "delivery-failed" });
    }
    req.on("response", (res) => {
      res.resume();
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) resolve({ ok: false, status, error: "redirect-blocked" });
      else if (status >= 200 && status < 300) resolve({ ok: true, status });
      else resolve({ ok: false, status, error: `http-${status}` });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => resolve({ ok: false, error: err.message || "delivery-failed" }));
    req.end(body);
  });
}
