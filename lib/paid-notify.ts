/**
 * Per-endpoint paid-notify switches. Not env-controlled.
 *
 * Stream and hooks are live because the real-move path in lib/notify-run.ts
 * waits for a post-start threshold print, measures correlation, and consumes a
 * grant unit only when that print fires. AgentMail `send` stays paused: this
 * fix does not give it a real delivery. Tests may flip the fields on this
 * object. There is no env var that turns a paused rail back on.
 */

export const PAID_NOTIFY: { stream: boolean; hooks: boolean; agentmail: boolean } = {
  stream: true,
  hooks: true,
  agentmail: false,
};

export const PAID_NOTIFY_PAUSED_REASON = "paid-notify-paused";

export function paidStreamLive(): boolean {
  return PAID_NOTIFY.stream === true;
}

export function paidHooksLive(): boolean {
  return PAID_NOTIFY.hooks === true;
}

export function paidAgentmailLive(): boolean {
  return PAID_NOTIFY.agentmail === true;
}
