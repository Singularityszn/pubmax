import { after } from "next/server";

import { currentDeploymentId } from "@/lib/deploymentEnv";

/**
 * THE ONE PLACE AN ALERT LEAVES THE PROCESS.
 *
 * The audit of 6 October 2026 found `[ALERT]` lines, a stale feed, a moderation
 * backlog, a spent paid budget, with no reader: they went to Vercel runtime logs
 * that keep a day or so. `lib/freshnessNotify.ts`, `lib/socialModerationNotify.ts`
 * and `lib/log.ts` (every error-level event, and the named warn events in
 * `ALERT_WARN_EVENTS`) now hand a line to `sendAlert`, which posts it to ONE
 * webhook named by `PUBMAX_ALERT_WEBHOOK_URL`.
 *
 * FIVE rules.
 *
 * (1) UNSET IS SILENT. No variable, no request, no log line about the missing
 *     variable. A deployment without a webhook behaves exactly as it did before.
 * (2) THE URL IS A SECRET. A Discord or Slack webhook is a bearer credential, so
 *     the name is in `lib/productionSecretEnvNames.ts`, only `https:` is
 *     accepted, and the URL is never logged, thrown or echoed.
 * (3) IT CANNOT BECOME THE INCIDENT. A source repeats at most once per
 *     `ALERT_COOLDOWN_MS` per instance (a suppressed count rides the next
 *     message), the process sends at most `ALERT_HOURLY_CAP` an hour, the
 *     request times out after `ALERT_TIMEOUT_MS`, and nothing here ever throws
 *     or logs through `log()`, so an alert about the sink cannot loop.
 * (4) THE BODY WORKS FOR BOTH. `content` is Discord's field and `text` is
 *     Slack's, so one URL of either kind works with no configuration.
 * (5) NO USER DATA LEAVES. The webhook is not a processor the privacy page
 *     names, so `log()` sends the event name, level and time alone, never its
 *     fields or error text, and every other caller sends system text only:
 *     counts, feed ids, city names. No account id, handle, object key or key.
 *     The sink adds the deployment id, so an alert says which build raised it.
 */

export const ALERT_WEBHOOK_ENV = "PUBMAX_ALERT_WEBHOOK_URL";
export const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
export const ALERT_HOURLY_CAP = 30;
const ALERT_TIMEOUT_MS = 3_000;
export const ALERT_MAX_TEXT = 1_500;

/** Warn-level events an operator must hear about, beside every error-level one. */
export const ALERT_WARN_EVENTS: ReadonlySet<string> = new Set(["paid_spend.budget_spent"]);

export type Alert = { source: string; text: string };

type SinkState = {
  lastSentAt: Map<string, number>;
  suppressed: Map<string, number>;
  windowStartedAt: number;
  sentInWindow: number;
};

const state: SinkState = {
  lastSentAt: new Map(),
  suppressed: new Map(),
  windowStartedAt: 0,
  sentInWindow: 0,
};

/** Test seam: forget every cooldown and the hourly count. */
export function resetAlertSink(): void {
  state.lastSentAt.clear();
  state.suppressed.clear();
  state.windowStartedAt = 0;
  state.sentInWindow = 0;
}

/** The webhook, or null when it is unset or is not an https URL. */
export function alertWebhookUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[ALERT_WEBHOOK_ENV]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

type SendDeps = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function admit(source: string, now: number): { send: boolean; suppressed: number } {
  if (now - state.windowStartedAt >= 60 * 60 * 1000) {
    state.windowStartedAt = now;
    state.sentInWindow = 0;
  }
  const last = state.lastSentAt.get(source);
  if (last !== undefined && now - last < ALERT_COOLDOWN_MS) {
    state.suppressed.set(source, (state.suppressed.get(source) ?? 0) + 1);
    return { send: false, suppressed: 0 };
  }
  if (state.sentInWindow >= ALERT_HOURLY_CAP) return { send: false, suppressed: 0 };
  state.sentInWindow += 1;
  state.lastSentAt.set(source, now);
  const suppressed = state.suppressed.get(source) ?? 0;
  state.suppressed.delete(source);
  return { send: true, suppressed };
}

/**
 * Post one alert. Never throws and never waits for the caller: the request is
 * handed to Next's `after` when a request scope exists, and runs on its own
 * otherwise. Returns the in-flight send for tests, or null when nothing was sent.
 */
export function sendAlert(alert: Alert, deps: SendDeps = {}): Promise<void> | null {
  try {
    const url = alertWebhookUrl(deps.env ?? process.env);
    if (!url) return null;
    const verdict = admit(alert.source, (deps.now ?? Date.now)());
    if (!verdict.send) return null;

    const repeats = verdict.suppressed > 0 ? ` (+${verdict.suppressed} suppressed)` : "";
    const deployment = currentDeploymentId() ?? "unknown";
    const message = `[pubmax][${alert.source}][deployment ${deployment}]${repeats} ${alert.text}`.slice(
      0,
      ALERT_MAX_TEXT,
    );
    const sent = (deps.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
      cache: "no-store",
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    }).then(
      () => undefined,
      () => undefined,
    );
    try {
      after(sent);
    } catch {
      /* No request scope to hang it on; the send above still runs. */
    }
    return sent;
  } catch {
    return null;
  }
}
