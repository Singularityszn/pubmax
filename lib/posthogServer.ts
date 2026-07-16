import type { AnalyticsEvent } from "@/lib/analyticsEvents";
import { isAnonymousAnalyticsId } from "@/lib/analyticsIdentity";

const POSTHOG_EU_CAPTURE_URL = "https://eu.i.posthog.com/capture/";
const POSTHOG_TIMEOUT_MS = 1_500;

export async function capturePosthogEvent(input: {
  event: AnalyticsEvent;
  path: string | null;
  anonymousId: unknown;
  analyticsConsent: unknown;
}): Promise<boolean> {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim();
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
          path: input.path,
          distinct_id: input.anonymousId,
          $process_person_profile: false,
        },
        timestamp: new Date().toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}
