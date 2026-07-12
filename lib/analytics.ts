// Client-side event beacon (Wave D · D0). One entry point — trackEvent — that
// the whole app uses to record a self-owned, privacy-first signal. This
// replaces the earlier Vercel Analytics-backed rail (R3); the same closed set
// of ~10 named events those cycle metrics depend on now lives in the shared
// registry (lib/analyticsEvents.ts) instead of a third-party `track()` call,
// so every existing caller (badge_tap, booking_click, tour_complete, etc.)
// keeps working unchanged.
//
// Privacy-first: honours Do-Not-Track, sends only registry-known events with
// allow-listed primitive props (validated again here as defence in depth), and
// carries NO identifier — just the event, its props, the coarse path, and a
// timestamp. Fire-and-forget: uses navigator.sendBeacon so it survives a page
// unload/navigation, falls back to keepalive fetch, and swallows every error so
// analytics can never break a user flow.

import {
  sanitizeEvent,
  type AnalyticsEventName,
  type AnalyticsProps,
} from "@/lib/analyticsEvents";

const ENDPOINT = "/api/events";

function doNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { doNotTrack?: string };
  const win = typeof window !== "undefined"
    ? (window as Window & { doNotTrack?: string })
    : undefined;
  const dnt = nav.doNotTrack ?? win?.doNotTrack;
  return dnt === "1" || dnt === "yes";
}

/**
 * Record a product event. No-ops on the server, under Do-Not-Track, or for an
 * unknown/invalid event name. Never throws.
 */
export function trackEvent(
  name: AnalyticsEventName,
  props?: AnalyticsProps,
): void {
  try {
    if (typeof window === "undefined") return;
    if (doNotTrack()) return;
    const event = sanitizeEvent(name, props);
    if (!event) return;

    const payload = JSON.stringify({
      name: event.name,
      props: event.props,
      path: window.location?.pathname ?? null,
      ts: Date.now(),
    });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
    // Fallback: keepalive fetch (still fire-and-forget).
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never break a flow */
  }
}

// ---------------------------------------------------------------------------
// lane_to_plan provenance (R3)
//
// `lane_to_plan` must only count plan creations that genuinely started on a
// What's-On / Tonight lane surface — otherwise it is indistinguishable from
// `plan_created` and reports conversions that never involved a lane. Lane
// surfaces link to the composer with `?src=<lane source>` (W1 Tonight-surface
// work adds `?src=tonight-lane`); anything else yields null and the event
// stays silent. Honest zero > invented signal.

/**
 * Exact allowlist of canonical `src` tokens that count as a lane surface for
 * `lane_to_plan`. EXACT matching only — never prefix matching — so a crafted
 * link like `/plan?src=whats-on-jane.doe@example.com` can never push raw
 * query text (potential PII / free text) into telemetry. Grow this set as
 * lane surfaces ship (W1 Tonight lane, What's-On verticals).
 */
const LANE_SOURCES = new Set([
  "tonight-lane",
  "whats-on-quiz",
  "whats-on-sport",
  "whats-on-deal",
  "whats-on-music",
]);

/**
 * Extract lane provenance from a location search string (e.g.
 * "?src=tonight-lane"). Returns the matched canonical token only when the
 * `src` value is EXACTLY one of the allowlisted lane sources; null otherwise
 * (missing, empty, unknown, or prefix-extended src → no event). Raw query
 * text is never forwarded into telemetry.
 */
export function laneSourceFromSearch(search: string): string | null {
  let src: string | null;
  try {
    src = new URLSearchParams(search).get("src");
  } catch {
    return null;
  }
  return src !== null && LANE_SOURCES.has(src) ? src : null;
}
