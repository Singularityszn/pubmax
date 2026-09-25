import { currentAnalyticsAttributionProps } from "@/lib/analyticsAttribution.mjs";
import { isPosthogConfigured } from "@/lib/posthogServer";

const POSTHOG_EU_CAPTURE_URL = "https://eu.i.posthog.com/capture/";
const POSTHOG_TIMEOUT_MS = 1_500;
const SERVER_DISTINCT_ID = "pubmaxx-server-runtime";

const SAFE_EXCEPTION_TYPES = new Set([
  "AggregateError",
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
]);

function safeType(error: unknown): string {
  if (error instanceof Error && SAFE_EXCEPTION_TYPES.has(error.name)) return error.name;
  return "Error";
}

/**
 * Report an unhandled server failure to PostHog error tracking (no message text).
 */
export function capturePosthogServerException(error: unknown, route = "server"): void {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim()
    || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
    || "";
  if (!apiKey || !isPosthogConfigured()) return;

  void fetch(POSTHOG_EU_CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: "$exception",
      properties: {
        ...currentAnalyticsAttributionProps(),
        distinct_id: SERVER_DISTINCT_ID,
        $process_person_profile: false,
        $exception_list: [{
          type: safeType(error),
          value: `Redacted (${route.slice(0, 40)})`,
        }],
      },
      timestamp: new Date().toISOString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
  }).catch(() => undefined);
}
