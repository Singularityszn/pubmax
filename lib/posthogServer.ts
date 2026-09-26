import { currentAnalyticsAttributionProps } from "@/lib/analyticsAttribution.mjs";
import type { AnalyticsEvent } from "@/lib/analyticsEvents";
import { isAnonymousAnalyticsId } from "@/lib/analyticsIdentity";

const POSTHOG_EU_CAPTURE_URL = "https://eu.i.posthog.com/capture/";
const POSTHOG_TIMEOUT_MS = 1_500;

function posthogProjectToken(): string {
  return process.env.POSTHOG_PROJECT_API_KEY?.trim()
    || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
    || "";
}

export function isPosthogConfigured(): boolean {
  return Boolean(posthogProjectToken());
}

export async function capturePosthogEvent(input: {
  event: AnalyticsEvent;
  path: string | null;
  anonymousId: unknown;
  analyticsConsent: unknown;
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
          ...currentAnalyticsAttributionProps(),
          path: input.path,
          distinct_id: input.anonymousId,
          ...(input.clientIp ? { $ip: input.clientIp } : {}),
          ...(input.userAgent ? { $raw_user_agent: input.userAgent } : {}),
          ...(input.referrer ? { $referrer: input.referrer } : {}),
          ...(input.screenWidth ? { $screen_width: input.screenWidth } : {}),
          ...(input.screenHeight ? { $screen_height: input.screenHeight } : {}),
          ...(input.viewportWidth ? { $viewport_width: input.viewportWidth } : {}),
          ...(input.viewportHeight ? { $viewport_height: input.viewportHeight } : {}),
          ...(input.insertId ? { $insert_id: input.insertId } : {}),
        },
        timestamp: input.occurredAt ?? new Date().toISOString(),
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
 */
export function capturePosthogServerEvent(input: {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
}): void {
  const apiKey = posthogProjectToken();
  if (!apiKey) return;

  void fetch(POSTHOG_EU_CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: input.event,
      properties: {
        ...input.properties,
        ...currentAnalyticsAttributionProps(),
        distinct_id: input.distinctId,
        $process_person_profile: false,
      },
      timestamp: new Date().toISOString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
  }).catch(() => undefined);
}
