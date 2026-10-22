import type {
  CaptureResult,
  PostHogConfig,
} from "posthog-js";
import {
  ANONYMOUS_ANALYTICS_STORAGE_KEY,
  isAnonymousAnalyticsId,
} from "@/lib/analyticsIdentity";
import {
  analyticsPageviewSurfaceFromPath,
  analyticsReferrerFromUrl,
  analyticsUrlWithoutQuery,
} from "@/lib/analyticsPath";
import { currentAnalyticsAttributionProps } from "@/lib/analyticsAttribution.mjs";
import {
  MAP_LOAD_TIMING_EVENT,
  sanitizeMapLoadTimingProps,
  type MapLoadTimingProps,
} from "@/lib/mapLoadTimingEvent";

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
const STANDARD_BROWSER_PROPERTIES = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$browser",
  "$browser_version",
  "$browser_language",
  "$browser_language_prefix",
  "$os",
  "$os_version",
  "$device",
  "$device_type",
  "$raw_user_agent",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$timezone",
  "$timezone_offset",
  "$current_url",
  "$host",
  "$pathname",
  "$referrer",
  "$referring_domain",
  "$initial_referrer",
  "$initial_referring_domain",
  "$lib",
  "$lib_version",
  // posthog-js stamps the api_host here whenever it is not a PostHog domain,
  // and PostHog's "reverse proxy detected" health check reads exactly this
  // property. Dropping it made the project report no proxy although every
  // browser event already went through /ingest. Its value is "/ingest".
  "$lib_custom_api_host",
  "$insert_id",
  "$time",
  "$session_id",
  "$window_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "dclid",
  "gclid",
  "gad_source",
  "gbraid",
  "wbraid",
  "msclkid",
  "fbclid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "igshid",
]);
const WEB_VITAL_METRICS = ["CLS", "FCP", "INP", "LCP"] as const;
const WEB_VITAL_RATINGS = new Set(["good", "needs-improvement", "poor"]);
type PostHogClient = (typeof import("posthog-js"))["default"];
type PendingPageview = {
  pathname: string;
  anonymousId: string;
  skipPreviousEngagement?: boolean;
};

const MAX_PENDING_PAGEVIEWS = 32;
let client: PostHogClient | null = null;
let clientLoad: Promise<PostHogClient | null> | null = null;
let consentRevision = 0;
let initialized = false;
let consentAllowedNow = false;
let captureEnabled = false;
const pendingPageviews: PendingPageview[] = [];
// One map visit sends one timing event; a visit that ends before the SDK has
// loaded keeps only its own, so the queue cannot grow.
type PendingMapLoadTiming = { timing: MapLoadTimingProps; at: number };
let pendingMapLoadTiming: PendingMapLoadTiming | null = null;
// A visit abandoned before the SDK loaded cannot leave this page, so it waits
// here, consent-scoped, and the next consented page sends it through the SDK
// under its own time. One row, a day at most: an old exit is not this week's.
const MAP_LOAD_TIMING_OUTBOX_KEY = "pubmaxx:map-load-timing-outbox:v1";
const MAP_LOAD_TIMING_OUTBOX_MAX_AGE_MS = 86_400_000;

function writeMapLoadTimingOutbox(row: PendingMapLoadTiming): void {
  try {
    window.localStorage.setItem(MAP_LOAD_TIMING_OUTBOX_KEY, JSON.stringify(row));
  } catch { /* storage blocked: the exit is lost, as before */ }
}

function clearMapLoadTimingOutbox(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(MAP_LOAD_TIMING_OUTBOX_KEY);
  } catch { /* best effort */ }
}

/** Read and remove the stored exit, rebuilt through the closed shape. */
function takeMapLoadTimingOutbox(now: number): PendingMapLoadTiming | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(MAP_LOAD_TIMING_OUTBOX_KEY);
    window.localStorage.removeItem(MAP_LOAD_TIMING_OUTBOX_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as { timing?: unknown; at?: unknown };
    const timing = sanitizeMapLoadTimingProps(row.timing);
    const at = row.at;
    if (
      !timing
      || typeof at !== "number"
      || !Number.isFinite(at)
      || at > now
      || now - at > MAP_LOAD_TIMING_OUTBOX_MAX_AGE_MS
    ) return null;
    return { timing, at };
  } catch {
    return null;
  }
}
let lastObservedPageviewPathname: string | null = null;
let skipPreviousEngagement = false;

const POSTHOG_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function engagementSurface(pathname: unknown): string | null {
  if (typeof pathname !== "string" || /^(?:\/activity|\/messages|\/u|\/you|\/profile|\/account|\/settings|\/login|\/signin|\/auth)(?:\/|$)/.test(pathname)) return null;
  return analyticsPageviewSurfaceFromPath(pathname);
}

/** Keep only SDK page correlation, seconds and scroll proportions. */
function pageEngagementProperties(properties: CaptureResult["properties"]): CaptureResult["properties"] {
  const result: CaptureResult["properties"] = {};
  if (typeof properties.$pageview_id === "string" && POSTHOG_UUID.test(properties.$pageview_id)) {
    result.$pageview_id = properties.$pageview_id;
  }
  const previous = engagementSurface(properties.$prev_pageview_pathname);
  if (!previous || properties.$pubmaxx_skip_previous_engagement === true) return result;
  if (typeof properties.$prev_pageview_id !== "string" || !POSTHOG_UUID.test(properties.$prev_pageview_id)) return result;
  result.$prev_pageview_id = properties.$prev_pageview_id;
  result.$prev_pageview_pathname = previous;
  const duration = properties.$prev_pageview_duration;
  if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration <= 86_400) {
    result.$prev_pageview_duration = duration;
  }
  for (const dimension of ["last_scroll", "max_scroll", "last_content", "max_content"]) {
    const key = `$prev_pageview_${dimension}_percentage`;
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) result[key] = value;
  }
  return result;
}

function safeExceptionType(value: unknown): string {
  return typeof value === "string" && SAFE_EXCEPTION_TYPES.has(value)
    ? value
    : "Error";
}

/**
 * The coarse surface a crash happened on, in the closed pageview vocabulary.
 * Falls back to the current URL's path when the SDK did not attach $pathname.
 */
function exceptionSurface(properties: CaptureResult["properties"]): string | null {
  const fromPathname = analyticsPageviewSurfaceFromPath(properties.$pathname);
  if (fromPathname) return fromPathname;
  const currentUrl = analyticsUrlWithoutQuery(properties.$current_url);
  if (!currentUrl) return null;
  try {
    return analyticsPageviewSurfaceFromPath(new URL(currentUrl).pathname);
  } catch {
    return null;
  }
}

/**
 * Error tracking fingerprints a crash on its type and message, so a constant
 * message collapses every crash of one JS type into a single issue that can
 * never be told apart. The message stays redacted, and carries the coarse
 * surface instead: two crashes on different surfaces stay separate issues,
 * and no user text, URL or stack frame leaves the browser to do it.
 */
function redactedExceptionValue(surface: string | null): string {
  return surface ? `Redacted (${surface})` : "Redacted";
}

function standardBrowserProperties(
  properties: CaptureResult["properties"],
  pathname?: string,
): CaptureResult["properties"] {
  const standard: CaptureResult["properties"] = {
    ...Object.fromEntries(
      Object.entries(properties).filter(([name]) =>
        STANDARD_BROWSER_PROPERTIES.has(name)),
    ),
    // The same two dimensions the server sender stamps on a named event
    // (lib/analyticsAttribution.mjs), so ONE filter tells a preview or a test
    // journey from a drinker's real night across both transports. The SDK
    // already sends $host; a named event never can.
    ...currentAnalyticsAttributionProps(),
  };
  for (const metric of WEB_VITAL_METRICS) {
    const valueKey = `$web_vitals_${metric}_value`;
    const eventKey = `$web_vitals_${metric}_event`;
    const value = properties[valueKey];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    standard[valueKey] = value;

    const rawEvent = properties[eventKey];
    if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) continue;
    const event = rawEvent as Record<string, unknown>;
    if (
      event.name !== metric
      || event.value !== value
      || typeof event.rating !== "string"
      || !WEB_VITAL_RATINGS.has(event.rating)
    ) continue;
    standard[eventKey] = {
      name: metric,
      value,
      rating: event.rating,
    };
  }
  const currentUrl = analyticsUrlWithoutQuery(properties.$current_url);
  if (pathname) {
    standard.$pathname = pathname;
    if (currentUrl) {
      standard.$current_url = new URL(pathname, currentUrl).toString();
    } else {
      delete standard.$current_url;
    }
  }
  for (const name of ["$referrer", "$initial_referrer"] as const) {
    const url = analyticsReferrerFromUrl(properties[name], currentUrl);
    if (url) standard[name] = url;
    else delete standard[name];
  }
  return standard;
}

function resolvePosthogDeviceId(generatedId: string): string {
  if (typeof window === "undefined") return generatedId;
  try {
    const storedId = window.localStorage.getItem(ANONYMOUS_ANALYTICS_STORAGE_KEY);
    return isAnonymousAnalyticsId(storedId) ? storedId : generatedId;
  } catch {
    return generatedId;
  }
}

/**
 * Browser SDK owns explicit pageviews, page exits, standard web vitals, and scrubbed
 * exception counts. Its before-send hook is a closed system-event registry:
 * DOM autocapture and custom product events are rejected here.
 *
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
    if (event.properties.distinct_id !== distinctId) return null;

    return {
      uuid: event.uuid,
      event: "$pageview",
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: {
        ...standardBrowserProperties(event.properties, pathname),
        ...(engagementSurface(rawPathname) ? pageEngagementProperties(event.properties) : {}),
        distinct_id: distinctId,
        $device_id: distinctId,
        $pathname: pathname,
      },
    };
  }

  if (event.event === "$pageleave") {
    const distinctId = event.properties.distinct_id;
    const pathname = engagementSurface(event.properties.$pathname);
    const engagement = pageEngagementProperties(event.properties);
    if (!isAnonymousAnalyticsId(distinctId) || !pathname || !engagement.$prev_pageview_id) return null;
    return {
      uuid: event.uuid,
      event: "$pageleave",
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: {
        ...standardBrowserProperties(event.properties, String(engagement.$prev_pageview_pathname)),
        ...engagement,
      },
    };
  }

  if (event.event === "$web_vitals") {
    const distinctId = event.properties.distinct_id;
    const rawPathname = event.properties.$pathname;
    const pathname = typeof rawPathname === "string"
      ? analyticsPageviewSurfaceFromPath(rawPathname)
      : null;
    if (!isAnonymousAnalyticsId(distinctId) || !pathname) return null;
    return {
      uuid: event.uuid,
      event: "$web_vitals",
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: standardBrowserProperties(event.properties, pathname),
    };
  }

  if (event.event === MAP_LOAD_TIMING_EVENT) {
    const distinctId = event.properties.distinct_id;
    if (!isAnonymousAnalyticsId(distinctId)) return null;
    const timing = sanitizeMapLoadTimingProps(event.properties);
    if (!timing) return null;
    const known = timing.surface.startsWith("/");
    const properties = standardBrowserProperties(
      event.properties,
      known ? timing.surface : undefined,
    );
    // An unnamed surface keeps no URL at all rather than a raw path.
    if (!known) {
      delete properties.$current_url;
      delete properties.$pathname;
    }
    return {
      uuid: event.uuid,
      event: MAP_LOAD_TIMING_EVENT,
      ...(event.timestamp ? { timestamp: event.timestamp } : {}),
      properties: { ...properties, ...timing },
    };
  }

  if (event.event !== "$exception") return null;

  const distinctId = event.properties.distinct_id;
  if (!isAnonymousAnalyticsId(distinctId)) return null;

  const rawExceptions = event.properties.$exception_list;
  if (!Array.isArray(rawExceptions) || rawExceptions.length === 0) return null;

  const surface = exceptionSurface(event.properties);
  const exceptionList = rawExceptions.slice(0, 8).map((exception) => ({
    type: safeExceptionType(
      exception && typeof exception === "object"
        ? (exception as Record<string, unknown>).type
        : undefined,
    ),
    value: redactedExceptionValue(surface),
  }));
  const properties = standardBrowserProperties(event.properties);
  delete properties.$current_url;
  delete properties.$pathname;
  delete properties.$referrer;
  delete properties.$initial_referrer;
  if (surface) properties.$pathname = surface;

  return {
    uuid: event.uuid,
    event: "$exception",
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    properties: {
      ...properties,
      distinct_id: distinctId,
      $device_id: distinctId,
      $exception_list: exceptionList,
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
  // The SDK puts route-exit measurements on the next explicit pageview and
  // sends the final pageleave by beacon. before_send bounds both shapes.
  capture_pageleave: true,
  capture_performance: true,
  // Replay, heatmaps, surveys, identify and flags stay off: the privacy page
  // promises none of them, and before_send would drop their events anyway.
  // __tests__/posthogSdkBoundary.test.ts proves it against the real SDK.
  capture_heatmaps: false,
  capture_dead_clicks: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_external_dependency_loading: false,
  // One /ingest request per flush instead of one per event: a page view, its
  // $web_vitals and any $exception share a request, and each request is a
  // billed function invocation through app/ingest/[...path]/route.ts.
  request_batching: true,
  persistence: "localStorage+cookie",
  save_campaign_params: true,
  save_referrer: true,
  get_device_id: resolvePosthogDeviceId,
  opt_in_site_apps: false,
  person_profiles: "always",
  // No feature-flag request, which before_send never sees, and no URL
  // fragment in captured URLs, including the initial person properties.
  advanced_disable_flags: true,
  disable_capture_url_hashes: true,
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
  skipPreviousEngagement = true;
  if (!consentAllowed) {
    pendingPageviews.length = 0;
    pendingMapLoadTiming = null;
    clearMapLoadTimingOutbox();
    lastObservedPageviewPathname = null;
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
      // A release identified signed-in browsers with the account id, which
      // persisted. before_send drops every event under that id, so start a
      // fresh anonymous person from the consented device id.
      if (!isAnonymousAnalyticsId(loadedClient.get_distinct_id())) {
        loadedClient.reset(true);
      }
    } else {
      // opt-out clears PostHog persistence. Re-seed from the newly created
      // consent-scoped ID before capture resumes so SDK Web Vitals and named
      // events keep one device identity after a later opt-in.
      loadedClient.reset(true);
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
    const pageviews = pendingPageviews.splice(0);
    for (const [index, pageview] of pageviews.entries()) {
      loadedClient.capture("$pageview", {
        $pathname: pageview.pathname,
        $pubmaxx_anonymous_id: pageview.anonymousId,
        // Replayed views cannot measure earlier routes' scroll or duration.
        ...((pageview.skipPreviousEngagement || index > 0) ? { $pubmaxx_skip_previous_engagement: true } : {}),
      });
    }
    const pending = pendingMapLoadTiming;
    pendingMapLoadTiming = null;
    const stored = takeMapLoadTimingOutbox(Date.now());
    for (const row of [stored, pending]) {
      if (!row || (row === stored && pending && stored.at === pending.at)) continue;
      loadedClient.capture(MAP_LOAD_TIMING_EVENT, row.timing, { timestamp: new Date(row.at) });
    }
  }).catch(() => undefined);
}

/**
 * Send one map visit's field timing through the browser SDK. Silent without
 * analytics consent; before_send rebuilds the closed shape again. A visit that
 * ends as the page is hidden goes by beacon so the tail is not lost on exit,
 * and one that ends before the SDK has loaded waits in a consent-scoped outbox
 * for the next consented page.
 */
export function capturePosthogMapLoadTiming(
  props: MapLoadTimingProps,
  options: { beacon?: boolean } = {},
): void {
  if (!consentAllowedNow) return;
  const timing = sanitizeMapLoadTimingProps(props);
  if (!timing) return;
  if (!initialized || !client || !captureEnabled) {
    pendingMapLoadTiming = { timing, at: Date.now() };
    if (options.beacon) writeMapLoadTimingOutbox(pendingMapLoadTiming);
    return;
  }
  client.capture(
    MAP_LOAD_TIMING_EVENT,
    timing,
    options.beacon ? { transport: "sendBeacon" } : undefined,
  );
}

/**
 * The browser SDK's current session id, so a named product event forwarded by
 * /api/events joins the same session as the pageviews and $web_vitals around
 * it. Null until consent has started capture. Reading it does not extend the
 * session.
 */
export function posthogSessionId(): string | null {
  if (!consentAllowedNow || !initialized || !captureEnabled || !client) return null;
  try {
    const sessionId = client.get_session_id();
    return typeof sessionId === "string" && POSTHOG_UUID.test(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
}

export function capturePosthogPageview(pathname: string, anonymousId: string | null): void {
  if (
    !safeBrowserPageviewPath(pathname)
    || !isAnonymousAnalyticsId(anonymousId)
    || !consentAllowedNow
  ) return;

  if (pathname === lastObservedPageviewPathname) return;
  lastObservedPageviewPathname = pathname;

  const analyticsSurface = analyticsPageviewSurfaceFromPath(pathname);
  if (!analyticsSurface) {
    skipPreviousEngagement = true;
    return;
  }
  const skipPrevious = skipPreviousEngagement;
  skipPreviousEngagement = false;

  if (!initialized || !client || !captureEnabled) {
    if (pendingPageviews.length >= MAX_PENDING_PAGEVIEWS) {
      pendingPageviews.splice(1, 1);
    }
    pendingPageviews.push({
      pathname: analyticsSurface,
      anonymousId,
      ...(skipPrevious ? { skipPreviousEngagement: true } : {}),
    });
    return;
  }

  client.capture("$pageview", {
    $pathname: analyticsSurface,
    $pubmaxx_anonymous_id: anonymousId,
    ...(skipPrevious ? { $pubmaxx_skip_previous_engagement: true } : {}),
  });
}

export function initializePosthog(consentAllowed: boolean): void {
  syncPosthogConsent(consentAllowed);
}
