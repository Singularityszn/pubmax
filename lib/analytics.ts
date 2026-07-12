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
