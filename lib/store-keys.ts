/**
 * Upstash key namespace per deployment environment.
 *
 * Production keeps the original un-prefixed keys so existing grant state
 * (bindings, used counts) stays valid. Preview and dev share the same Redis
 * but write under `preview:` / `dev:` so they never read or spend prod quota.
 */
type Env = Record<string, string | undefined>;

export function envKeyPrefix(env: Env = process.env): string {
  if (env.VERCEL_ENV === "production") return "";
  if (env.VERCEL_ENV === "preview") return "preview:";
  return "dev:";
}

export type StoreKeys = {
  grant: string;
  monitor: string;
  index: string;
  pending: string;
  outbox: string;
};

export function storeKeys(env: Env = process.env): StoreKeys {
  const p = envKeyPrefix(env);
  return {
    grant: `${p}harbinger:grant:`,
    monitor: `${p}harbinger:monitor:`,
    index: `${p}harbinger:monitor-idx:`,
    pending: `${p}harbinger:monitor-pending`,
    outbox: `${p}harbinger:monitor-outbox`,
  };
}
