/**
 * Real-move paid notify.
 *
 * A grant is validated with consume:false, a live baseline is stored, and the
 * caller polls (or the cron pump polls) until a post-start threshold print or
 * the watch deadline. The grant unit is consumed only inside the fired
 * transition. no-move leaves usage unchanged (Nic, 10 Oct 2026: no consumption
 * and no refund transaction). SSE emits one event and closes; it does not hold
 * the function open for the watch window.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { watchBookById, type WatchDef } from "@/lib/agency";
import { nowMs } from "@/lib/clock";
import { allowDemoGrant, checkGrant, DEMO_GRANT, parseTxGrant, type GrantCheck } from "@/lib/grant";
import type { GrantBinding } from "@/lib/grant-store";
import { callbackIsPublic, newHookSecret, signBody, validateCallbackUrl } from "@/lib/hook-delivery";
import { fetchInstrumentQuotes, type InstrumentQuote } from "@/lib/live-quote";
import { QUOTE_FUTURE_SKEW_MS, QUOTE_MAX_AGE_MS } from "@/lib/markets";
import { monitorStoreFromEnv, type Monitor, type MonitorStore } from "@/lib/monitor-store";
import {
  H,
  MEDIA,
  PROTOCOL,
  corsHeaders,
  findWatch,
  gateGrant,
  grantDeniedResponse,
  mintReceipt,
  paidHooksLive,
  paidNotifyPausedResponse,
  paidStreamLive,
  type Watch,
} from "@/lib/protocol";
import { decideTrigger, type LegObservation, type TriggerDecision } from "@/lib/trigger";

const POLL_AFTER_SEC = 30;
const SOURCE_NOTE =
  "Trigger uses the Yahoo 1-minute chart quote (regularMarketPrice / regularMarketTime, else the last 1-minute close). Hour bars are the patrol tape only and are not a fire source. A quote older than maxAgeMs, or timestamped at or before the monitor started, cannot fire.";

type OkCheck = Extract<GrantCheck, { ok: true }>;

function wellFormedGrant(raw: string | null): boolean {
  const g = (raw ?? "").trim();
  if (!g) return false;
  if (g === DEMO_GRANT) return allowDemoGrant();
  return parseTxGrant(g) !== null;
}

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": MEDIA,
      ...corsHeaders(),
      [H.version]: PROTOCOL,
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function storeUnavailable(): Response {
  return json(503, {
    protocol: PROTOCOL,
    status: 503,
    error: "grant-store-unavailable",
    meaning: "Grant binding store unavailable; refusing to open a paid monitor without a durable store.",
  });
}

function notPriceWatch(): Response {
  return json(400, {
    protocol: PROTOCOL,
    status: 400,
    error: "watch-not-on-price-trigger",
    meaning:
      "This watch has no price legs. Mail-sourced watches are not fired by the market trigger, and AgentMail send stays paused. No grant was bound or consumed.",
  });
}

function quoteProblem(error: "quote-stale" | "quote-unavailable", instruments: string): Response {
  return json(503, {
    protocol: PROTOCOL,
    status: 503,
    error,
    instruments,
    consumed: false,
    meaning:
      error === "quote-stale"
        ? "The live quote is older than the trigger allows, so no baseline was taken and no quota was consumed. Hour bars are not used as a fire source."
        : "A live quote was not available, so no monitor was opened and no quota was consumed.",
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function grantSnapshot(check: OkCheck, used: number) {
  if (check.kind !== "tx") return undefined;
  return {
    watchId: check.binding.watchId,
    used,
    quota: check.binding.quota,
    expiresAt: iso(check.binding.expiresAt),
  };
}

function baselineFrom(book: WatchDef, quotes: InstrumentQuote[], now: number) {
  const byId = new Map(quotes.map((q) => [q.instrumentId, q]));
  const baseline: Monitor["baseline"] = {};
  const stale: string[] = [];
  const bad: string[] = [];
  for (const leg of book.legs) {
    const q = byId.get(leg.instrumentId);
    if (!q || !q.ok || !(q.price > 0) || !Number.isFinite(q.asOf)) {
      bad.push(leg.instrumentId);
      continue;
    }
    if (q.stale || q.asOf > now + QUOTE_FUTURE_SKEW_MS) {
      stale.push(leg.instrumentId);
      continue;
    }
    baseline[leg.instrumentId] = { price: q.price, asOf: q.asOf };
  }
  if (bad.length) return { ok: false as const, error: "quote-unavailable" as const, instruments: bad.join(",") };
  if (stale.length) return { ok: false as const, error: "quote-stale" as const, instruments: stale.join(",") };
  return { ok: true as const, baseline };
}

function legView(l: LegObservation) {
  return {
    id: l.id,
    instrumentId: l.instrumentId,
    event: l.event,
    direction: l.direction,
    thresholdPct: l.thresholdPct,
    price: l.price,
    asOf: l.asOf == null ? null : iso(l.asOf),
    baseline: l.baseline,
    pct: l.pct,
    matched: l.matched,
    ignored: l.ignored,
  };
}

function fireBody(watch: Watch, m: Monitor, check: OkCheck, decision: Extract<TriggerDecision, { action: "fire" }>) {
  const matched = decision.legs.filter((l) => l.matched);
  const txRef = check.kind === "tx" ? check.txHash : null;
  const grant = grantSnapshot(check, check.kind === "tx" ? check.binding.used + 1 : 0);
  return {
    protocol: PROTOCOL,
    status: "fired" as const,
    watchId: watch.id,
    monitorId: m.id,
    event: matched.map((l) => l.event).join(watch.logic === "all" ? "+" : "|"),
    correlation: decision.correlation,
    correlationNote: decision.correlationNote,
    correlationSamples: decision.correlationSamples,
    advantageMs: watch.advantageMs,
    priceUsdc: watch.priceUsdc,
    receipt: mintReceipt(watch.id, txRef),
    firedAt: iso(decision.firedAt),
    consumed: true,
    conditions: matched.map((l) => l.event),
    legs: decision.legs.map(legView),
    delivery: watch.deliveries,
    source: {
      name: "yahoo-chart" as const,
      interval: "1m" as const,
      asOf: iso(decision.firedAt),
      maxAgeMs: QUOTE_MAX_AGE_MS,
      note: SOURCE_NOTE,
    },
    ...(txRef ? { settleTx: txRef } : {}),
    ...(grant ? { grant } : {}),
  };
}

function noMoveBody(watch: Watch, m: Monitor, check: OkCheck, decision: Extract<TriggerDecision, { action: "no-move" }>) {
  const grant = grantSnapshot(check, check.kind === "tx" ? check.binding.used : 0);
  return {
    protocol: PROTOCOL,
    status: "no-move" as const,
    watchId: watch.id,
    monitorId: m.id,
    firedAt: null,
    consumed: false,
    startedAt: iso(m.startedAt),
    deadlineAt: iso(m.deadlineAt),
    correlation: decision.correlation,
    correlationNote: decision.correlationNote,
    correlationSamples: decision.correlationSamples,
    legs: decision.legs.map(legView),
    note: "No post-start threshold move inside the watch window. The grant was not consumed. There is no refund transaction.",
    ...(grant ? { grant } : {}),
  };
}

function pendingBody(watch: Watch, m: Monitor, check: OkCheck, extra?: Record<string, unknown>) {
  const grant = grantSnapshot(check, check.kind === "tx" ? check.binding.used : 0);
  const baseline: Record<string, { price: number; asOf: string }> = {};
  for (const [id, point] of Object.entries(m.baseline)) baseline[id] = { price: point.price, asOf: iso(point.asOf) };
  return {
    protocol: PROTOCOL,
    status: "pending" as const,
    watchId: watch.id,
    monitorId: m.id,
    startedAt: iso(m.startedAt),
    deadlineAt: iso(m.deadlineAt),
    pollAfter: POLL_AFTER_SEC,
    firedAt: null,
    consumed: false,
    baseline,
    ...(grant ? { grant } : {}),
    ...extra,
  };
}

function respond(request: Request, body: object, pending: boolean): Response {
  const rec = body as Record<string, unknown>;
  const headers: Record<string, string> = { [H.monitor]: String(rec.monitorId ?? "") };
  if (typeof rec.receipt === "string") headers[H.receipt] = rec.receipt;
  if (typeof rec.watchId === "string") headers[H.watch] = rec.watchId;
  if ("correlation" in rec) headers[H.correlation] = rec.correlation == null ? "n/a" : String(rec.correlation);
  if (typeof rec.advantageMs === "number") headers[H.advantage] = String(rec.advantageMs);
  if (typeof rec.priceUsdc === "number") headers[H.price] = `${rec.priceUsdc} USDC`;
  if (Array.isArray(rec.delivery)) headers[H.delivery] = rec.delivery.join(",");
  const sse = (request.headers.get("accept") ?? "").includes("text/event-stream");
  if (sse) {
    const event = rec.status === "fired" ? "ping" : rec.status === "no-move" ? "no-move" : "pending";
    return new Response(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`, {
      status: 200,
      headers: { ...corsHeaders(), "content-type": "text/event-stream; charset=utf-8", [H.version]: PROTOCOL, "cache-control": "no-store", ...headers },
    });
  }
  return json(pending ? 202 : 200, body, headers);
}

function denyResponse(watch: Watch, check: OkCheck, reason: string, binding?: GrantBinding) {
  if (reason === "grant-missing") return storeUnavailable();
  const mapped =
    reason === "watch-mismatch" ? "grant-bound-to-other-watch" : reason === "expired" ? "grant-expired" : "grant-exhausted";
  const bound = binding ?? (check.kind === "tx" ? check.binding : undefined);
  return grantDeniedResponse(
    {
      ok: false,
      status: 403,
      reason: mapped,
      ...(check.kind === "tx" ? { txHash: check.txHash } : {}),
      ...(bound ? { binding: bound } : {}),
    },
    watch,
    watch.id,
  );
}

async function loadQuotes(book: WatchDef, now: number): Promise<InstrumentQuote[]> {
  try {
    return await fetchInstrumentQuotes(
      book.legs.map((l) => l.instrumentId),
      now,
    );
  } catch {
    return book.legs.map((l) => ({
      instrumentId: l.instrumentId,
      symbol: l.instrumentId,
      price: 0,
      asOf: 0,
      ok: false,
      stale: true,
      source: "yahoo-chart" as const,
      interval: "1m" as const,
      error: "fetch-failed",
    }));
  }
}

type Step =
  | { kind: "monitor"; monitor: Monitor }
  | { kind: "deny"; reason: string; binding?: GrantBinding };

async function evaluate(m: Monitor, watch: Watch, book: WatchDef, check: OkCheck, store: MonitorStore, now: number): Promise<Step> {
  if (m.status !== "pending") return { kind: "monitor", monitor: m };
  const quotes = await loadQuotes(book, now);
  const decision = decideTrigger({
    logic: book.logic,
    legs: book.legs.map((l) => ({
      id: l.id,
      instrumentId: l.instrumentId,
      event: l.event,
      direction: l.direction,
      thresholdPct: l.thresholdPct,
    })),
    baseline: m.baseline,
    samples: m.samples,
    quotes: quotes.map((q) => ({
      instrumentId: q.instrumentId,
      price: q.price,
      asOf: q.asOf,
      ok: q.ok,
      stale: q.stale,
    })),
    startedAt: m.startedAt,
    deadlineAt: m.deadlineAt,
    now,
  });
  if (decision.action === "fire") {
    const fin = await store.fire(m.id, now, decision.firedAt, fireBody(watch, m, check, decision) as Record<string, unknown>, decision.sample);
    if (fin.ok) return { kind: "monitor", monitor: fin.monitor };
    return { kind: "deny", reason: fin.reason, ...(fin.binding ? { binding: fin.binding } : {}) };
  }
  if (decision.action === "no-move") {
    const fin = await store.noMove(m.id, now, noMoveBody(watch, m, check, decision) as Record<string, unknown>);
    if (fin.ok) return { kind: "monitor", monitor: fin.monitor };
    if (fin.monitor) return { kind: "monitor", monitor: fin.monitor };
    return { kind: "deny", reason: fin.reason };
  }
  if (decision.sample) {
    const fin = await store.appendSample(m.id, decision.sample);
    if (fin.ok) return { kind: "monitor", monitor: fin.monitor };
  }
  const fresh = await store.get(m.id);
  return { kind: "monitor", monitor: fresh ?? m };
}

function render(request: Request, watch: Watch, check: OkCheck, m: Monitor, extra?: Record<string, unknown>): Response {
  if (m.status === "pending" || !m.result) return respond(request, pendingBody(watch, m, check, extra), true);
  return respond(request, m.result, false);
}

async function openOrResume(
  kind: "stream" | "hook",
  watch: Watch,
  book: WatchDef,
  check: OkCheck,
  store: MonitorStore,
  renew: boolean,
  hook?: { callbackUrl: string; hookSecret: string },
): Promise<{ problem: Response } | { monitor: Monitor; created: boolean }> {
  const grantKey = check.kind === "tx" ? check.txHash : "demo";
  const existing = await store.findByGrant(grantKey, watch.id);
  if (existing && existing.status === "pending" && existing.kind !== kind) {
    return {
      problem: json(409, {
        protocol: PROTOCOL,
        status: 409,
        error: "monitor-pending-other-kind",
        monitorId: existing.id,
        kind: existing.kind,
        meaning: "This grant already has a pending monitor for the watch on the other rail.",
      }),
    };
  }
  if (existing && existing.status === "pending" && kind === "hook" && hook && existing.callbackUrl && existing.callbackUrl !== hook.callbackUrl) {
    return {
      problem: json(409, {
        protocol: PROTOCOL,
        status: 409,
        error: "callback-locked",
        monitorId: existing.id,
        meaning: "A pending hook is already registered for this grant and watch.",
      }),
    };
  }
  if (existing && (existing.status === "pending" || !renew)) {
    return { monitor: existing, created: false };
  }
  const now = nowMs();
  const quotes = await loadQuotes(book, now);
  const base = baselineFrom(book, quotes, now);
  if (!base.ok) return { problem: quoteProblem(base.error, base.instruments) };
  const monitor: Monitor = {
    id: "mon_" + randomBytes(12).toString("hex"),
    kind,
    watchId: watch.id,
    grantKey,
    startedAt: now,
    deadlineAt: now + watch.windowMs,
    baseline: base.baseline,
    samples: [],
    status: "pending",
    firedAt: null,
    consumed: false,
    result: null,
    ...(hook ? { callbackUrl: hook.callbackUrl, hookSecret: hook.hookSecret } : {}),
  };
  const created = await store.create(monitor, renew && Boolean(existing));
  return { monitor: created.monitor, created: created.created };
}

function quotaSpent(check: OkCheck): boolean {
  return check.kind === "tx" && check.binding.used >= check.binding.quota;
}

async function withStore<T>(fn: (store: MonitorStore) => Promise<T>): Promise<T | Response> {
  const store = monitorStoreFromEnv();
  if (!store) return storeUnavailable();
  try {
    return await fn(store);
  } catch {
    return storeUnavailable();
  }
}

export async function handleStream(request: Request): Promise<Response> {
  if (!paidStreamLive()) return paidNotifyPausedResponse("stream");
  const url = new URL(request.url);
  const watchIdRaw = request.headers.get(H.watch) ?? url.searchParams.get("watch");
  const grantRaw = request.headers.get(H.grant);
  if (wellFormedGrant(grantRaw)) {
    const named = findWatch(watchIdRaw);
    if (named && !watchBookById(named.id)) return notPriceWatch();
  }
  const gate = await gateGrant(grantRaw, watchIdRaw, { consume: false, route: new URL(request.url).pathname });
  if (!gate.ok) return gate.response;
  const book = watchBookById(gate.watch.id);
  if (!book) return notPriceWatch();
  const renew = request.headers.get(H.renew) === "1";
  const monitorHeader = request.headers.get(H.monitor);
  const out = await withStore(async (store) => {
    const check = gate.check;
    if (monitorHeader) {
      const m = await store.get(monitorHeader);
      const grantKey = check.kind === "tx" ? check.txHash : "demo";
      if (!m || m.grantKey !== grantKey || m.watchId !== gate.watch.id) {
        return json(404, { protocol: PROTOCOL, status: 404, error: "monitor-not-found" });
      }
      const step = await evaluate(m, gate.watch, book, check, store, nowMs());
      if (step.kind === "deny") return denyResponse(gate.watch, check, step.reason, step.binding);
      return render(request, gate.watch, check, step.monitor);
    }
    if (quotaSpent(check) && !renew) {
      return denyResponse(gate.watch, check, "exhausted");
    }
    if (quotaSpent(check) && renew) return denyResponse(gate.watch, check, "exhausted");
    const opened = await openOrResume("stream", gate.watch, book, check, store, renew);
    if ("problem" in opened) return opened.problem;
    if (opened.created) return render(request, gate.watch, check, opened.monitor);
    const step = await evaluate(opened.monitor, gate.watch, book, check, store, nowMs());
    if (step.kind === "deny") return denyResponse(gate.watch, check, step.reason, step.binding);
    return render(request, gate.watch, check, step.monitor);
  });
  return out;
}

async function readHookBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleHookPost(request: Request): Promise<Response> {
  if (!paidHooksLive()) return paidNotifyPausedResponse("hooks");
  const body = await readHookBody(request);
  const watchIdRaw = (typeof body.watchId === "string" ? body.watchId : null) ?? request.headers.get(H.watch);
  const grantRaw = request.headers.get(H.grant);
  if (wellFormedGrant(grantRaw)) {
    const named = findWatch(watchIdRaw);
    if (named && !watchBookById(named.id)) return notPriceWatch();
  }
  const gate = await gateGrant(grantRaw, watchIdRaw, { consume: false, route: new URL(request.url).pathname });
  if (!gate.ok) return asHookDenial(gate.response);
  const callback = validateCallbackUrl(body.callbackUrl);
  if (!callback.ok) {
    return json(400, {
      protocol: PROTOCOL,
      status: 400,
      error: "callback-invalid",
      reason: callback.reason,
      meaning: "Callback must be https and must not target a private, loopback, or metadata host. No quota was consumed.",
    });
  }
  const book = watchBookById(gate.watch.id);
  if (!book) return notPriceWatch();
  const renew = request.headers.get(H.renew) === "1";
  const out = await withStore(async (store) => {
    const check = gate.check;
    if (quotaSpent(check)) return denyHook(check);
    const opened = await openOrResume("hook", gate.watch, book, check, store, renew, {
      callbackUrl: callback.href,
      hookSecret: newHookSecret(),
    });
    if ("problem" in opened) return opened.problem;
    const extra = {
      accepted: true,
      ...(opened.monitor.hookSecret ? { hookSecret: opened.monitor.hookSecret } : {}),
      ...(opened.monitor.callbackUrl ? { callbackUrl: opened.monitor.callbackUrl } : {}),
    };
    if (opened.created) return render(request, gate.watch, check, opened.monitor, extra);
    const step = await evaluate(opened.monitor, gate.watch, book, check, store, nowMs());
    if (step.kind === "deny") return denyHook(check, step.reason);
    if (step.monitor.status === "pending") return render(request, gate.watch, check, step.monitor, extra);
    return render(request, gate.watch, check, step.monitor);
  });
  return out;
}

function hookForbidden(reason: string): Response {
  return new Response(JSON.stringify({ forbidden: reason }), {
    status: 403,
    headers: { "content-type": MEDIA, [H.forbidden]: reason, [H.version]: PROTOCOL, ...corsHeaders() },
  });
}

function asHookDenial(res: Response): Response {
  if (res.status !== 403) return res;
  return hookForbidden(res.headers.get(H.forbidden) ?? "grant-required");
}

function denyHook(_check: OkCheck, reason = "exhausted"): Response {
  const mapped =
    reason === "watch-mismatch" ? "grant-bound-to-other-watch" : reason === "expired" ? "grant-expired" : "grant-exhausted";
  return hookForbidden(mapped);
}

export async function handleHookGet(request: Request): Promise<Response> {
  if (!paidHooksLive()) return paidNotifyPausedResponse("hooks");
  const url = new URL(request.url);
  const watchIdRaw = request.headers.get(H.watch) ?? url.searchParams.get("watch");
  const grantRaw = request.headers.get(H.grant);
  if (wellFormedGrant(grantRaw)) {
    const named = findWatch(watchIdRaw);
    if (named && !watchBookById(named.id)) return notPriceWatch();
  }
  const gate = await gateGrant(grantRaw, watchIdRaw, { consume: false, route: new URL(request.url).pathname });
  if (!gate.ok) return asHookDenial(gate.response);
  const book = watchBookById(gate.watch.id);
  if (!book) return notPriceWatch();
  const out = await withStore(async (store) => {
    const grantKey = gate.check.kind === "tx" ? gate.check.txHash : "demo";
    const named = request.headers.get(H.monitor) ?? url.searchParams.get("monitor");
    const m = named ? await store.get(named) : await store.findByGrant(grantKey, gate.watch.id);
    if (!m || m.grantKey !== grantKey || m.watchId !== gate.watch.id) {
      return json(404, { protocol: PROTOCOL, status: 404, error: "monitor-not-found" });
    }
    const step = await evaluate(m, gate.watch, book, gate.check, store, nowMs());
    if (step.kind === "deny") return denyHook(gate.check, step.reason);
    return render(request, gate.watch, gate.check, step.monitor);
  });
  return out;
}

function cronGate(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return json(503, {
      protocol: PROTOCOL,
      status: 503,
      error: "cron-secret-missing",
      meaning: "The notify pump is fail-closed until CRON_SECRET is set. No delivery was attempted.",
    });
  }
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return json(401, { protocol: PROTOCOL, status: 401, error: "cron-unauthorized" });
  }
  return null;
}

async function deliverOne(store: MonitorStore, id: string, now: number): Promise<"delivered" | "failed" | "skipped"> {
  const claim = await store.claimDelivery(id, now);
  if (!claim.ok || !claim.claimed || !claim.monitor) return "skipped";
  const m = claim.monitor;
  if (!m.callbackUrl || !m.hookSecret || !m.result) {
    await store.ackDelivery(id, now, false, "incomplete", true);
    return "failed";
  }
  const safe = await callbackIsPublic(m.callbackUrl);
  if (!safe.ok) {
    const terminal = safe.reason === "ssrf" || safe.reason === "private-ip" || safe.reason === "callback-invalid";
    await store.ackDelivery(id, now, false, safe.reason, terminal);
    return "failed";
  }
  const body = JSON.stringify(m.result);
  try {
    const res = await fetch(m.callbackUrl, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      body,
      headers: {
        "content-type": MEDIA,
        [H.signature]: signBody(m.hookSecret, body),
        "X-Harbinger-Delivery-Id": m.id,
        [H.version]: PROTOCOL,
      },
    });
    if (res.status >= 200 && res.status < 300) {
      await store.ackDelivery(id, now, true);
      return "delivered";
    }
    await store.ackDelivery(id, now, false, `http-${res.status}`);
    return "failed";
  } catch (err) {
    await store.ackDelivery(id, now, false, err instanceof Error ? err.message : "fetch-failed");
    return "failed";
  }
}

export async function handlePump(request: Request): Promise<Response> {
  const denied = cronGate(request);
  if (denied) return denied;
  const out = await withStore(async (store) => {
    const now = nowMs();
    let fired = 0;
    let noMove = 0;
    let pending = 0;
    let errors = 0;
    for (const id of await store.listPending(50)) {
      try {
        const m = await store.get(id);
        if (!m || m.status !== "pending") continue;
        const watch = findWatch(m.watchId);
        const book = watch ? watchBookById(watch.id) : null;
        if (!watch || !book) {
          errors += 1;
          continue;
        }
        const check: OkCheck | null = m.grantKey === "demo" ? { ok: true, kind: "demo" } : await liveTxCheck(m);
        if (!check) {
          errors += 1;
          continue;
        }
        const step = await evaluate(m, watch, book, check, store, now);
        if (step.kind === "deny") {
          errors += 1;
          continue;
        }
        if (step.monitor.status === "fired") fired += 1;
        else if (step.monitor.status === "no-move") noMove += 1;
        else pending += 1;
      } catch {
        errors += 1;
      }
    }
    let delivered = 0;
    let deliveryFailed = 0;
    for (const id of await store.listOutbox(50)) {
      try {
        const result = await deliverOne(store, id, now);
        if (result === "delivered") delivered += 1;
        else if (result === "failed") deliveryFailed += 1;
      } catch {
        deliveryFailed += 1;
      }
    }
    return json(200, {
      protocol: PROTOCOL,
      ok: true,
      fired,
      noMove,
      pending,
      delivered,
      deliveryFailed,
      errors,
    });
  });
  return out;
}

async function liveTxCheck(m: Monitor): Promise<OkCheck | null> {
  const watch = findWatch(m.watchId);
  if (!watch) return null;
  const check = await checkGrant(`hp1.${m.grantKey}`, m.watchId, watch, { consume: false, now: nowMs(), internal: true });
  if (!check.ok || check.kind !== "tx") return null;
  return check;
}
