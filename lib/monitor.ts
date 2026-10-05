/** Condition-gated paid ping.
 *
 * A grant is validated and bound with consume:false. The first fresh quote is
 * the baseline and cannot fire. A later quote, strictly after `startedAt` and
 * inside the watch window, fires once and spends one quota unit. If the window
 * ends first, the result is `no-move`: quota is unchanged and no refund is
 * written. That credit rule is awaiting Nic's sign-off.
 *
 * SSE does not stay open for the watch window. Clients poll. Hook callbacks are
 * queued here and posted by the scheduled pump. Catalog copy still marks
 * webhook outbound not-live until a preview probe.
 */
import { INSTRUMENTS, WATCH_BOOK } from "@/lib/agency";
import { checkGrant } from "@/lib/grant";
import { grantStoreFromEnv } from "@/lib/grant-store";
import { postHook, signHookBody, type DeliveryResult } from "@/lib/hook";
import { fetchQuotes, type Quote } from "@/lib/markets";
import {
  monitorId,
  monitorStoreFromEnv,
  resetSharedMonitor,
  type ConsumeOutcome,
  type GrantSnap,
  type Monitor,
  type MonitorStore,
} from "@/lib/monitor-store";
import {
  challengeResponse,
  findWatch,
  grantDeniedResponse,
  mintReceipt,
  PROTOCOL,
  type GrantCheck,
  type Watch,
} from "@/lib/protocol";
import { stepTrigger, type EvalLeg, type Measurement, type TriggerDecision } from "@/lib/trigger";

export const PING_POLL_AFTER_SEC = 60;
export const NO_MOVE_CREDIT = "no-consume-no-refund" as const;
export const HOOK_MAX_ATTEMPTS = 5;

const CREDIT_NOTE = "Pending Nic's sign-off: a no-move does not consume quota and does not write a refund.";

export type TxCheck = Extract<GrantCheck, { ok: true; kind: "tx" }>;
export type OkCheck = Extract<GrantCheck, { ok: true }>;

type QuoteLoader = (symbols: string[], now: number) => Promise<Quote[]>;
type DeliverFn = (job: { url: string; body: string; signature: string }) => Promise<DeliveryResult>;

let nowOverride: number | null = null;
let quoteOverride: QuoteLoader | null = null;
let deliverOverride: DeliverFn | null = null;

export function setNowForTests(now: number | null) {
  nowOverride = now;
}
export function setQuotesForTests(loader: QuoteLoader | null) {
  quoteOverride = loader;
}
export function setDeliverForTests(fn: DeliverFn | null) {
  deliverOverride = fn;
}
export function monitorNow(): number {
  return nowOverride ?? Date.now();
}
export function resetMonitorForTests() {
  nowOverride = null;
  quoteOverride = null;
  deliverOverride = null;
  resetSharedMonitor();
}

export function formatCorrelation(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(2);
}

export function legsForWatch(watchId: string): EvalLeg[] {
  const book = WATCH_BOOK.find((w) => w.id === watchId);
  if (!book) return [];
  return book.legs.map((leg) => {
    const inst = INSTRUMENTS.find((i) => i.id === leg.instrumentId);
    return {
      instrumentId: leg.instrumentId,
      symbol: inst?.symbol ?? leg.instrumentId,
      label: leg.label,
      event: leg.event,
      direction: leg.direction,
      thresholdPct: leg.thresholdPct,
      windowMinutes: leg.windowMinutes,
    };
  });
}

function grantKeyOf(check: OkCheck): string {
  return check.kind === "tx" ? check.txHash : "demo";
}

async function loadQuotes(legs: EvalLeg[], now: number): Promise<Map<string, Quote>> {
  const symbols = [...new Set(legs.map((l) => l.symbol))];
  const map = new Map<string, Quote>();
  if (!symbols.length) return map;
  let quotes: Quote[];
  try {
    quotes = quoteOverride ? await quoteOverride(symbols, now) : await fetchQuotes(symbols, now);
  } catch (err) {
    const error = err instanceof Error ? err.message : "fetch failed";
    quotes = symbols.map((symbol) => ({
      symbol,
      price: null,
      asOf: null,
      ok: false,
      stale: true,
      source: "yahoo-chart" as const,
      interval: "1m" as const,
      error,
    }));
  }
  for (const q of quotes) map.set(q.symbol, q);
  return map;
}

function blank(check: OkCheck, watch: Watch, grantRaw: string, now: number, generation: number, url?: string): Monitor {
  const grantKey = grantKeyOf(check);
  return {
    id: monitorId(grantKey, watch.id, generation),
    version: 1,
    generation,
    grantKey,
    grantRaw,
    watchId: watch.id,
    status: "pending",
    startedAt: now,
    deadlineAt: now + watch.windowMs,
    baseline: null,
    samples: [],
    firedAt: null,
    correlation: null,
    correlationNote: null,
    receipt: null,
    ping: null,
    deliveryBody: null,
    consumed: false,
    ...(url ? { hook: { url, state: "armed" as const, attempts: 0, lockedUntil: 0 } } : {}),
    ...(check.kind === "tx"
      ? {
          grant: {
            watchId: check.binding.watchId,
            used: check.binding.used,
            quota: check.binding.quota,
            expiresAt: check.binding.expiresAt,
          },
        }
      : {}),
  };
}

function legJson(rows: Measurement[]) {
  return rows.map((row) => ({
    instrumentId: row.instrumentId,
    symbol: row.symbol,
    label: row.label,
    event: row.event,
    direction: row.direction,
    thresholdPct: row.thresholdPct,
    windowMinutes: row.windowMinutes,
    baseline: row.baseline,
    price: row.price,
    asOf: new Date(row.asOf).toISOString(),
    pct: row.pct,
    matched: row.matched,
  }));
}

function buildPing(m: Monitor, watch: Watch, decision: Extract<TriggerDecision, { action: "fire" }>): Record<string, unknown> {
  const matched = decision.measurements.filter((row) => row.matched).map((row) => row.event);
  const tx = m.grantKey === "demo" ? null : m.grantKey;
  const ping: Record<string, unknown> = {
    protocol: PROTOCOL,
    status: "fired",
    watchId: watch.id,
    logic: watch.logic,
    event: decision.measurements.map((row) => row.event).join(watch.logic === "all" ? "+" : "|"),
    correlation: decision.correlation,
    correlationNote: decision.correlationNote,
    advantageMs: watch.advantageMs,
    priceUsdc: watch.priceUsdc,
    receipt: mintReceipt(watch.id, tx),
    firedAt: new Date(decision.firedAt).toISOString(),
    source: "yahoo-chart",
    quoteInterval: "1m",
    asOf: new Date(decision.firedAt).toISOString(),
    conditions: matched,
    legs: legJson(decision.measurements),
    samples: decision.samples.length,
    delivery: watch.deliveries,
    monitorId: m.id,
    ...(tx ? { settleTx: tx } : {}),
  };
  if (m.grantKey === "demo") ping.grant = { kind: "demo" };
  else if (m.grant) {
    ping.grant = {
      watchId: m.grant.watchId,
      used: m.grant.used,
      quota: m.grant.quota,
      expiresAt: new Date(m.grant.expiresAt).toISOString(),
    };
  }
  return ping;
}

function consumeFor(m: Monitor, now: number): () => Promise<ConsumeOutcome> {
  return async () => {
    const store = grantStoreFromEnv();
    if (!store) return { ok: false, reason: "unavailable" };
    const watch = findWatch(m.watchId);
    const check = await checkGrant(m.grantRaw, m.watchId, watch, { consume: true, now, store });
    if (!check.ok) {
      if (check.status === 503) return { ok: false, reason: "unavailable" };
      if (check.reason === "grant-expired") return { ok: false, reason: "expired" };
      if (check.reason === "grant-exhausted") return { ok: false, reason: "exhausted" };
      return { ok: false, reason: "unbound" };
    }
    if (check.kind !== "tx") return { ok: true, demo: true };
    const grant: GrantSnap = {
      watchId: check.binding.watchId,
      used: check.binding.used,
      quota: check.binding.quota,
      expiresAt: check.binding.expiresAt,
    };
    return { ok: true, grant };
  };
}

async function applyStep(store: MonitorStore, current: Monitor, watch: Watch, decision: TriggerDecision, now: number): Promise<Monitor> {
  if (decision.action === "keep") return current;
  let next: Monitor = {
    ...current,
    baseline: decision.baseline,
    samples: decision.samples,
    correlation: "correlation" in decision ? decision.correlation : current.correlation,
    correlationNote: "correlationNote" in decision ? decision.correlationNote : current.correlationNote,
  };
  let op: "save" | "fire" | "nomove" = "save";
  if (decision.action === "fire") {
    op = "fire";
    const ping = buildPing(current, watch, decision);
    next = {
      ...next,
      status: "fired",
      firedAt: decision.firedAt,
      correlation: decision.correlation,
      correlationNote: decision.correlationNote,
      receipt: String(ping.receipt),
      ping,
      hook: current.hook ? { ...current.hook, state: "queued" } : undefined,
    };
  } else if (decision.action === "no-move") {
    op = "nomove";
    next = {
      ...next,
      status: "no-move",
      firedAt: null,
      correlation: decision.correlation,
      correlationNote: decision.correlationNote,
      hook: current.hook ? { ...current.hook, state: "skipped" } : undefined,
    };
  }
  const res = await store.commit({
    expectedVersion: current.version,
    next,
    op,
    now,
    consume: op === "fire" ? consumeFor(current, now) : undefined,
  });
  if (res.monitor) return res.monitor;
  if (!res.ok && res.reason === "conflict") {
    const again = await store.get(current.id);
    if (again) return again;
  }
  return current;
}

export async function advanceMonitor(m: Monitor, watch: Watch, now: number, store: MonitorStore): Promise<Monitor> {
  let current = m;
  for (let attempt = 0; attempt < 6; attempt++) {
    const fresh = await store.get(current.id);
    if (!fresh) return current;
    if (fresh.status !== "pending") return fresh;
    const legs = legsForWatch(fresh.watchId);
    const quotes = await loadQuotes(legs, now);
    const decision = stepTrigger(
      { startedAt: fresh.startedAt, deadlineAt: fresh.deadlineAt, baseline: fresh.baseline, samples: fresh.samples },
      watch.logic,
      legs,
      quotes,
      now,
    );
    if (decision.action === "keep") return fresh;
    const written = await applyStep(store, fresh, watch, decision, now);
    if (written.status !== "pending") return written;
    current = written;
  }
  return (await store.get(current.id)) ?? current;
}

export type PollBody = { http: 200; body: Record<string, unknown>; correlation: number | null; receipt: string | null };
export type PollDenied = { http: 403 | 503; response: Response };
export type PollResult = PollBody | PollDenied;

function denied(check: Extract<GrantCheck, { ok: false }>, watch: Watch): PollDenied {
  return { http: check.status === 503 ? 503 : 403, response: grantDeniedResponse(check, watch, watch.id) };
}

function closedDenial(m: Monitor, watch: Watch): PollDenied {
  const reason =
    m.closedReason === "expired" ? "grant-expired" : m.closedReason === "exhausted" ? "grant-exhausted" : "grant-required";
  return { http: 403, response: challengeResponse(watch, reason, m.grant) };
}

async function liveGrant(m: Monitor): Promise<Record<string, unknown> | undefined> {
  if (m.grantKey === "demo") return { kind: "demo" };
  const store = grantStoreFromEnv();
  const binding = store ? await store.get(m.grantKey) : null;
  const snap = binding ?? m.grant;
  if (!snap) return undefined;
  return {
    watchId: snap.watchId,
    used: snap.used,
    quota: snap.quota,
    expiresAt: new Date(snap.expiresAt).toISOString(),
  };
}

export async function renderMonitor(m: Monitor, watch: Watch): Promise<PollResult> {
  if (m.status === "closed") return closedDenial(m, watch);
  if (m.status === "fired" && m.ping) {
    const correlation = typeof m.ping.correlation === "number" ? m.ping.correlation : null;
    const receipt = typeof m.ping.receipt === "string" ? m.ping.receipt : m.receipt;
    return { http: 200, body: m.ping, correlation, receipt };
  }
  const grant = await liveGrant(m);
  if (m.status === "no-move") {
    return {
      http: 200,
      correlation: m.correlation,
      receipt: null,
      body: {
        protocol: PROTOCOL,
        status: "no-move",
        watchId: watch.id,
        monitorId: m.id,
        firedAt: null,
        correlation: m.correlation,
        correlationNote: m.correlationNote,
        startedAt: new Date(m.startedAt).toISOString(),
        deadlineAt: new Date(m.deadlineAt).toISOString(),
        credit: NO_MOVE_CREDIT,
        creditNote: CREDIT_NOTE,
        rearm: "X-Harbinger-Rearm: 1",
        meaning: "Window ended with no in-window threshold cross.",
        ...(grant ? { grant } : {}),
        ...(m.grantKey !== "demo" ? { settleTx: m.grantKey } : {}),
      },
    };
  }
  const legs = legsForWatch(watch.id);
  return {
    http: 200,
    correlation: null,
    receipt: null,
    body: {
      protocol: PROTOCOL,
      status: "pending",
      watchId: watch.id,
      logic: watch.logic,
      monitorId: m.id,
      startedAt: new Date(m.startedAt).toISOString(),
      deadlineAt: new Date(m.deadlineAt).toISOString(),
      pollAfter: PING_POLL_AFTER_SEC,
      firedAt: null,
      correlation: null,
      baselineReady: Boolean(m.baseline),
      ...(!m.baseline && legs.length ? { observation: "no-fresh-quote" } : {}),
      meaning: "Watch armed. No quota spent until a post-start sample crosses the leg thresholds. Poll after pollAfter seconds.",
      ...(grant ? { grant } : {}),
      ...(m.grantKey !== "demo" ? { settleTx: m.grantKey } : {}),
    },
  };
}

function quotaSpent(check: OkCheck): boolean {
  return check.kind === "tx" && check.binding.used >= check.binding.quota;
}

function storeUnavailable(check: OkCheck, watch: Watch): PollDenied {
  return denied(
    { ok: false, status: 503, reason: "grant-store-unavailable", ...(check.kind === "tx" ? { txHash: check.txHash } : {}) },
    watch,
  );
}

export async function pollStream(opts: { watch: Watch; check: OkCheck; grantRaw: string; rearm: boolean; now: number }): Promise<PollResult> {
  const store = monitorStoreFromEnv();
  if (!store) return storeUnavailable(opts.check, opts.watch);
  const key = grantKeyOf(opts.check);
  let existing = await store.find(key, opts.watch.id);

  if (existing?.status === "pending" && !opts.rearm) {
    const next = await advanceMonitor(existing, opts.watch, opts.now, store);
    return renderMonitor(next, opts.watch);
  }
  if (existing?.status === "no-move" && !opts.rearm) return renderMonitor(existing, opts.watch);
  if (quotaSpent(opts.check)) {
    return denied(
      {
        ok: false,
        status: 403,
        reason: "grant-exhausted",
        ...(opts.check.kind === "tx" ? { txHash: opts.check.txHash, binding: opts.check.binding } : {}),
      },
      opts.watch,
    );
  }
  if (existing?.status === "fired" && !opts.rearm) return renderMonitor(existing, opts.watch);

  const generation = existing ? existing.generation + 1 : 1;
  const created = await store.create(blank(opts.check, opts.watch, opts.grantRaw, opts.now, generation));
  const next = await advanceMonitor(created, opts.watch, opts.now, store);
  return renderMonitor(next, opts.watch);
}

export type HookArm =
  | { ok: true; monitorId: string | null }
  | { ok: false; denied: PollDenied };

/** Arm or refresh a callback subscription. Does not spend quota. */
export async function registerHook(opts: {
  watch: Watch;
  check: OkCheck;
  grantRaw: string;
  url: string;
  now: number;
}): Promise<HookArm> {
  const store = monitorStoreFromEnv();
  if (!store) return { ok: false, denied: storeUnavailable(opts.check, opts.watch) };
  const key = grantKeyOf(opts.check);
  const existing = await store.find(key, opts.watch.id);
  if (existing?.status === "pending") {
    if (existing.hook?.url !== opts.url) {
      const next: Monitor = { ...existing, hook: { url: opts.url, state: "armed", attempts: 0, lockedUntil: 0 } };
      const res = await store.commit({ expectedVersion: existing.version, next, op: "attach", now: opts.now });
      const current = res.monitor ?? existing;
      await advanceMonitor(current, opts.watch, opts.now, store);
      return { ok: true, monitorId: current.id };
    }
    await advanceMonitor(existing, opts.watch, opts.now, store);
    return { ok: true, monitorId: existing.id };
  }
  if (quotaSpent(opts.check)) {
    return {
      ok: false,
      denied: denied(
        {
          ok: false,
          status: 403,
          reason: "grant-exhausted",
          ...(opts.check.kind === "tx" ? { txHash: opts.check.txHash, binding: opts.check.binding } : {}),
        },
        opts.watch,
      ),
    };
  }
  // A finished no-move subscription stays put. Opening another window is an
  // explicit stream rearm, so a retried POST cannot reset the clock.
  if (existing?.status === "no-move") return { ok: true, monitorId: existing.id };
  const generation = existing ? existing.generation + 1 : 1;
  const created = await store.create(blank(opts.check, opts.watch, opts.grantRaw, opts.now, generation, opts.url));
  await advanceMonitor(created, opts.watch, opts.now, store);
  return { ok: true, monitorId: created.id };
}

export type PumpReport = {
  ok: true;
  pending: number;
  fired: number;
  noMove: number;
  delivered: number;
  failed: number;
  signing: "ready" | "missing";
};

export async function runPump(now: number): Promise<PumpReport> {
  const store = monitorStoreFromEnv();
  if (!store) return { ok: true, pending: 0, fired: 0, noMove: 0, delivered: 0, failed: 0, signing: hookSecret() ? "ready" : "missing" };
  const pending = await store.listPending();
  let fired = 0;
  let noMove = 0;
  for (const m of pending) {
    const watch = findWatch(m.watchId);
    if (!watch) continue;
    const before = m.status;
    const next = await advanceMonitor(m, watch, now, store);
    if (before === "pending" && next.status === "fired") fired += 1;
    if (before === "pending" && next.status === "no-move") noMove += 1;
  }
  const dispatch = await dispatchOutbox(now, store);
  return {
    ok: true,
    pending: pending.length,
    fired,
    noMove,
    delivered: dispatch.delivered,
    failed: dispatch.failed,
    signing: hookSecret() ? "ready" : "missing",
  };
}

function hookSecret(): string | null {
  const secret = process.env.HOOK_SIGNING_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

async function dispatchOutbox(now: number, store: MonitorStore): Promise<{ delivered: number; failed: number }> {
  const secret = hookSecret();
  const due = await store.listOutbox(now);
  let delivered = 0;
  let failed = 0;
  for (const m of due) {
    if (!m.hook || !m.deliveryBody) continue;
    if (!secret) continue;
    const claimed = await store.claimDelivery(m.id, now);
    if (!claimed?.hook || !claimed.deliveryBody) continue;
    const signature = signHookBody(secret, claimed.deliveryBody);
    const result = deliverOverride
      ? await deliverOverride({ url: claimed.hook.url, body: claimed.deliveryBody, signature })
      : await postHook(claimed.hook.url, claimed.deliveryBody, signature);
    await store.settleDelivery(claimed.id, { ok: result.ok, ...(result.error ? { error: result.error } : {}) }, HOOK_MAX_ATTEMPTS);
    if (result.ok) delivered += 1;
    else failed += 1;
  }
  return { delivered, failed };
}
