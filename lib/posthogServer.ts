import { after } from "next/server";

import { currentAnalyticsAttributionProps } from "@/lib/analyticsAttribution.mjs";
import type { AnalyticsEvent } from "@/lib/analyticsEvents";
import { isAnonymousAnalyticsId } from "@/lib/analyticsIdentity";

const POSTHOG_EU_CAPTURE_URL = "https://eu.i.posthog.com/capture/";
const POSTHOG_TIMEOUT_MS = 1_500;
// Every event this app sends names its sender, so none lands in PostHog with
// no $lib. The browser SDK stamps its own ("web"); a named product event
// relayed by /api/events and a server-originated event each say which they are.
const POSTHOG_EVENTS_RELAY_LIB = "pubmaxx-events-relay";
const POSTHOG_SERVER_LIB = "pubmaxx-server";

function posthogProjectToken(): string {
  return process.env.POSTHOG_PROJECT_API_KEY?.trim()
    || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
    || "";
}

export function isPosthogConfigured(): boolean {
  return Boolean(posthogProjectToken());
}

// PostHog leaves an event out of its session when the session id's UUIDv7 time
// is later than the event, and the session id is minted on the visitor's clock
// while this timestamp is the server's. A clock running ahead by a few minutes
// is common, so the event is moved up to its session's start; a session id
// further ahead than that is not trusted and is dropped.
const MAX_SESSION_CLOCK_SKEW_MS = 5 * 60_000;

function sessionAlignedTimestamp(
  sessionId: string | undefined,
  eventMs: number,
): { sessionId?: string; timestampMs: number } {
  if (!sessionId) return { timestampMs: eventMs };
  const sessionStartMs = Number.parseInt(sessionId.replace(/-/g, "").slice(0, 12), 16);
  if (!Number.isFinite(sessionStartMs) || sessionStartMs - eventMs > MAX_SESSION_CLOCK_SKEW_MS) {
    return { timestampMs: eventMs };
  }
  return { sessionId, timestampMs: Math.max(eventMs, sessionStartMs) };
}

function coarseCurrentUrl(origin: string, path: string): URL | null {
  try {
    const url = new URL(path, origin);
    return url.origin === origin ? url : null;
  } catch {
    return null;
  }
}

export async function capturePosthogEvent(input: {
  event: AnalyticsEvent;
  path: string | null;
  anonymousId: unknown;
  analyticsConsent: unknown;
  /** The request's own origin; with `path` it forms the coarse $current_url. */
  origin?: string;
  /** The browser SDK's session id, already validated by the caller. */
  sessionId?: string;
  clientIp?: string;
  userAgent?: string;
  referrer?: string;
  screenWidth?: number;
  screenHeight?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  insertId?: string;
  occurredAt?: string;
}): Promise<boolean> {
  const apiKey = posthogProjectToken();
  if (!apiKey || input.analyticsConsent !== true || !isAnonymousAnalyticsId(input.anonymousId)) return false;
  const currentUrl = input.origin && input.path ? coarseCurrentUrl(input.origin, input.path) : null;
  const occurredMs = input.occurredAt ? Date.parse(input.occurredAt) : Number.NaN;
  const eventMs = Number.isFinite(occurredMs) ? occurredMs : Date.now();
  const { sessionId, timestampMs } = sessionAlignedTimestamp(input.sessionId, eventMs);

  try {
    const response = await fetch(POSTHOG_EU_CAPTURE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: input.event.name,
        properties: {
          ...input.event.props,
          // AFTER the event's own props, so a registry prop can never overwrite
          // the lane an event says it came from. lib/analyticsAttribution.mjs
          // owns both words; a named event carries no $host by design, and
          // docs/analytics/METRICS.md says environment is the filter instead.
          // $current_url below names the host only because web analytics needs
          // a URL to place the event on its page.
          ...currentAnalyticsAttributionProps(),
          path: input.path,
          distinct_id: input.anonymousId,
          $lib: POSTHOG_EVENTS_RELAY_LIB,
          ...(sessionId ? { $session_id: sessionId } : {}),
          // The same coarse surface path a browser $pageview carries, never the
          // raw path, so web analytics can place the event on its page.
          ...(currentUrl
            ? { $current_url: currentUrl.href, $pathname: input.path }
            : {}),
          ...(input.clientIp ? { $ip: input.clientIp } : {}),
          ...(input.userAgent ? { $raw_user_agent: input.userAgent } : {}),
          ...(input.referrer ? { $referrer: input.referrer } : {}),
          ...(input.screenWidth ? { $screen_width: input.screenWidth } : {}),
          ...(input.screenHeight ? { $screen_height: input.screenHeight } : {}),
          ...(input.viewportWidth ? { $viewport_width: input.viewportWidth } : {}),
          ...(input.viewportHeight ? { $viewport_height: input.viewportHeight } : {}),
          ...(input.insertId ? { $insert_id: input.insertId } : {}),
        },
        timestamp: new Date(timestampMs).toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget one server-originated event under a fixed server distinct id,
 * with no person profile. The caller owns which properties are safe to send.
 * Inside a request scope the bounded send is handed to `after`, so a serverless
 * function stays alive until it lands; outside one (a process hook, a test)
 * `after` throws and the started promise is the whole of it.
 */
export function capturePosthogServerEvent(input: {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}): void {
  const apiKey = posthogProjectToken();
  if (!apiKey) return;

  const sent = fetch(POSTHOG_EU_CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: input.event,
      properties: {
        ...input.properties,
        ...currentAnalyticsAttributionProps(),
        distinct_id: input.distinctId,
        $lib: POSTHOG_SERVER_LIB,
        $process_person_profile: false,
      },
      timestamp: new Date().toISOString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
  }).then(() => undefined, () => undefined);
  try {
    after(sent);
  } catch {
    /* No request scope to hang it on; the send above still runs. */
  }
}
