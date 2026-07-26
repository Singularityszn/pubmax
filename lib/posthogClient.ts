import posthog, {
  type CaptureResult,
  type PostHogConfig,
} from "posthog-js";

const SAFE_EXCEPTION_TYPES = new Set([
  "AggregateError",
  "DOMException",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let initialized = false;

function safeExceptionType(value: unknown): string {
  return typeof value === "string" && SAFE_EXCEPTION_TYPES.has(value)
    ? value
    : "Error";
}

/**
 * Browser SDK owns only anonymous exception counts. Product events stay on
 * trackEvent -> /api/events, where registry, consent, and DNT are rechecked.
 */
export function sanitizePosthogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event || event.event !== "$exception") return null;

  const distinctId = event.properties.distinct_id;
  if (typeof distinctId !== "string" || !UUID_PATTERN.test(distinctId)) return null;

  const rawExceptions = event.properties.$exception_list;
  if (!Array.isArray(rawExceptions) || rawExceptions.length === 0) return null;

  const exceptionList = rawExceptions.slice(0, 8).map((exception) => ({
    type: safeExceptionType(
      exception && typeof exception === "object"
        ? (exception as Record<string, unknown>).type
        : undefined,
    ),
    value: "Redacted",
  }));
  const token = event.properties.token;
  const deviceId = event.properties.$device_id;

  return {
    uuid: event.uuid,
    event: "$exception",
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    properties: {
      ...(typeof token === "string" ? { token } : {}),
      distinct_id: distinctId,
      ...(typeof deviceId === "string" && UUID_PATTERN.test(deviceId)
        ? { $device_id: deviceId }
        : {}),
      $exception_list: exceptionList,
      $process_person_profile: false,
    },
  };
}

export const posthogBrowserConfig = {
  api_host: "/ingest",
  ui_host: "https://eu.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  autocapture: false,
  rageclick: false,
  capture_pageview: false,
  capture_pageleave: false,
  capture_performance: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_external_dependency_loading: false,
  request_batching: false,
  persistence: "memory",
  save_campaign_params: false,
  save_referrer: false,
  opt_in_site_apps: false,
  person_profiles: "never",
  advanced_disable_flags: true,
  opt_out_capturing_by_default: true,
  opt_out_persistence_by_default: true,
  respect_dnt: true,
  before_send: sanitizePosthogEvent,
} satisfies Partial<PostHogConfig>;

export function syncPosthogConsent(consentAllowed: boolean): void {
  if (consentAllowed) {
    if (!initialized) {
      const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
      if (!token) return;
      posthog.init(token, posthogBrowserConfig);
      initialized = true;
    }
    posthog.opt_in_capturing({ captureEventName: false });
  } else if (initialized) {
    posthog.opt_out_capturing();
  }
}

export function initializePosthog(consentAllowed: boolean): void {
  syncPosthogConsent(consentAllowed);
}
