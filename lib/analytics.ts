// Typed product-analytics rail over Vercel Analytics (R3). Cycle metrics
// depend on a small, closed set of named events — this module is the ONLY
// place that set is allowed to grow, so every caller stays in sync with the
// metrics contract and nobody free-types an event name that silently never
// gets counted.
//
// Privacy posture: cookie-less (Vercel Web Analytics), no PII. Props are
// intentionally flat and primitive-only (string | number | boolean) — venue
// ids, tiers, counts, and booleans are fine; a display name, message body,
// address, or any other free-text user content is NOT. Callers must not pass
// user-authored text as a prop value.

import { track } from "@vercel/analytics";

/** Closed union of the ~10 named events the R3 cycle metrics depend on. */
export type AnalyticsEventName =
  | "badge_tap"
  | "lane_card_tap"
  | "lane_to_plan"
  | "cmdk_open"
  | "night_mode_active"
  | "drop_logged"
  | "booking_click"
  | "whats_on_filter"
  | "tour_complete"
  | "plan_created";

/** No PII, no free-text user content — venue ids, tiers, counts are OK. */
export type AnalyticsEventProps = Record<string, string | number | boolean>;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Track a typed product event. No-ops safely on the server (SSR/RSC render,
 * route handlers, build) and under test, where `window` is undefined —
 * mirrors the storage-guard idiom in lib/firstRunTour.ts and the
 * performance.mark guard in lib/performanceMarks.ts. Never throws: analytics
 * is best-effort and must never break the app (a blocked script, an
 * ad-blocker, or a missing DSN should be silent).
 */
export function trackEvent(name: AnalyticsEventName, props?: AnalyticsEventProps): void {
  if (!hasWindow()) return;
  try {
    track(name, props);
  } catch {
    // Best-effort only — swallow so a blocked/ad-blocked analytics script
    // never surfaces as an app error.
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

/** `src` prefixes that count as a lane surface for `lane_to_plan`. */
const LANE_SOURCE_PREFIXES = ["tonight-lane", "whats-on"] as const;

/**
 * Extract lane provenance from a location search string (e.g.
 * "?src=tonight-lane"). Returns the `src` value when it names a known lane
 * surface, null otherwise (missing, empty, or unknown src → no event).
 */
export function laneSourceFromSearch(search: string): string | null {
  let src: string | null;
  try {
    src = new URLSearchParams(search).get("src");
  } catch {
    return null;
  }
  if (!src) return null;
  return LANE_SOURCE_PREFIXES.some((prefix) => src.startsWith(prefix)) ? src : null;
}
