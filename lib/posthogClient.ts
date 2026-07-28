import type {
  CaptureResult,
  PostHogConfig,
} from "posthog-js";
import { isAnonymousAnalyticsId } from "@/lib/analyticsIdentity";
import { analyticsPageviewSurfaceFromPath } from "@/lib/analyticsPath";

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
type PostHogClient = (typeof import("posthog-js"))["default"];
let client: PostHogClient | null = null;
let clientLoad: Promise<PostHogClient | null> | null = null;
let consentRevision = 0;
let initialized = false;
let consentAllowedNow = false;
let captureEnabled = false;
let pendingPageview: {
  pathname: string;
  routeKey: string;
  anonymousId: string;
} | null = null;
let lastCapturedPageviewRouteKey: string | null = null;

function safeExceptionType(value: unknown): string {
  return typeof value === "string" && SAFE_EXCEPTION_TYPES.has(value)
    ? value
    : "Error";
}

/**
 * Browser SDK owns explicit anonymous pageviews and anonymous exception counts.
 * Product events stay on trackEvent -> /api/events, where registry, consent,
 * and DNT are rechecked.
 */
export function sanitizePosthogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return null;

  if (event.event === "$pageview") {
    const distinctId = event.properties.$pubmaxx_anonymous_id;
    const rawPathname = event.properties.$pathname;
    const pathname = safeBrowserPageviewPath(rawPathname)
      ? analyticsPageviewSurfaceFromPath(rawPathname)
      : null;
    if (!isAnonymousAnalyticsId(distinctId) || !pathname) return null;

    const token = event.properties.token;
    return {
      uuid: event.uuid,
      event: "$pageview",
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: {
        ...(typeof token === "string" ? { token } : {}),
        distinct_id: distinctId,
        $pathname: pathname,
        $process_person_profile: false,
      },
    };
  }

  if (event.event !== "$exception") return null;

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

function safeBrowserPageviewPath(value: unknown): value is string {
  return (
    typeof value === "string"
    && !value.includes("?")
    && !value.includes("#")
  );
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
  // PostHog drops HeadlessChrome before before_send. Production browser tests
  // use an inert public token and opt out of that SDK filter so they can prove
  // the real transport path. Production builds never set this flag.
  ...(process.env.NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT === "1"
    ? { opt_out_useragent_filter: true }
    : {}),
  respect_dnt: true,
  before_send: sanitizePosthogEvent,
} satisfies Partial<PostHogConfig>;

function loadPosthogClient(): Promise<PostHogClient | null> {
  if (client) return Promise.resolve(client);
  if (!clientLoad) {
    clientLoad = import("posthog-js")
      .then(({ default: loadedClient }) => {
        client = loadedClient;
        return loadedClient;
      })
      .catch(() => null)
      .finally(() => {
        clientLoad = null;
      });
  }
  return clientLoad;
}

export function syncPosthogConsent(consentAllowed: boolean): void {
  const revision = ++consentRevision;
  consentAllowedNow = consentAllowed;
  captureEnabled = false;
  if (!consentAllowed) {
    pendingPageview = null;
    lastCapturedPageviewRouteKey = null;
    if (initialized) client?.opt_out_capturing();
    return;
  }

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  if (!token) return;

  void loadPosthogClient().then((loadedClient) => {
    if (!loadedClient || revision !== consentRevision) return;
    if (!initialized) {
      loadedClient.init(token, posthogBrowserConfig);
      initialized = true;
    }
    if (revision !== consentRevision) {
      loadedClient.opt_out_capturing();
      return;
    }
    loadedClient.opt_in_capturing({ captureEventName: false });
    if (revision !== consentRevision) {
      loadedClient.opt_out_capturing();
      return;
    }
    captureEnabled = true;
    const pageview = pendingPageview;
    pendingPageview = null;
    if (pageview) {
      lastCapturedPageviewRouteKey = pageview.routeKey;
      loadedClient.capture("$pageview", {
        $pathname: pageview.pathname,
        $pubmaxx_anonymous_id: pageview.anonymousId,
      });
    }
  }).catch(() => undefined);
}

export function capturePosthogPageview(pathname: string, anonymousId: string | null): void {
  const analyticsSurface = safeBrowserPageviewPath(pathname)
    ? analyticsPageviewSurfaceFromPath(pathname)
    : null;
  if (
    !analyticsSurface
    || !isAnonymousAnalyticsId(anonymousId)
    || !consentAllowedNow
    || pathname === lastCapturedPageviewRouteKey
    || pathname === pendingPageview?.routeKey
  ) return;

  if (!initialized || !client || !captureEnabled) {
    pendingPageview = {
      pathname: analyticsSurface,
      routeKey: pathname,
      anonymousId,
    };
    return;
  }

  lastCapturedPageviewRouteKey = pathname;
  client.capture("$pageview", {
    $pathname: analyticsSurface,
    $pubmaxx_anonymous_id: anonymousId,
  });
}

export function initializePosthog(consentAllowed: boolean): void {
  syncPosthogConsent(consentAllowed);
}
