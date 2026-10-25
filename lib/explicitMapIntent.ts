import { searchHasExplicitMapIntent } from "@/lib/mapUrlIntent";
export { searchHasExplicitMapIntent } from "@/lib/mapUrlIntent";

// Shared "explicit Map intent" answer (trusted-handoff §4.7).
//
// One pure predicate that both first-run surfaces consume — the generic
// first-run tour AND the curated "Start with a story" onboarding — so a Map
// arrival that is already intentional never gets a tour or onboarding card
// stacked over it. "Intentional" means any of:
//
//   - an explicit URL param: sel, q, pubs, mode(=build), plan=1, log=1, and the
//     accepted-handoff markers accept=1 / src=<source> (§4.6, §4.8);
//   - a valid restored PlanningIntent (only when the caller passes one — intent
//     read is flag-gated, so the caller decides whether to look);
//   - a restored mobile Map session that was mid-Venue or mid-planner.
//
// Server-safe: no window/DOM/React. The URL predicates live in mapUrlIntent,
// without the map rendering and price helpers, and only ADD
// the trusted-handoff params, so it stays a superset of today's suppression —
// it can never make a previously-suppressed onboarding arrival re-appear.
//
// Suppression is per-arrival only: it reflects THIS mount's frozen search +
// restored state, and never marks onboarding complete. A later clean Map open
// (no params, no restore) returns false and stays tour/onboarding eligible.

import type { MobileMapSessionV1 } from "@/lib/mobileShell";
import type { PlanningIntentV1 } from "@/lib/planningIntent";

/**
 * Whether a restored mobile Map session represents intentional continuation —
 * a Venue that was open, or planner/Route state (planner sheet or a remembered
 * Night Area). A bare viewport/filter restore is not, on its own, intent.
 */
export function restoredSessionHasExplicitIntent(
  session: MobileMapSessionV1 | null,
): boolean {
  if (!session) return false;
  return (
    Boolean(session.selectedVenueId) ||
    session.openSheet === "venue" ||
    session.openSheet === "planner" ||
    session.nightArea !== null
  );
}

export type ExplicitMapIntentInput = {
  /** The arrival query string, frozen once at mount (never re-read after sync). */
  search: string;
  /**
   * A valid restored PlanningIntent, or null. The caller gates this on the
   * intent-read flag: pass null when intent read is off so stored intent is
   * ignored (but preserved) exactly as the flag's off-behaviour requires.
   */
  planningIntent: PlanningIntentV1 | null;
  /** The restored mobile Map session for this city, or null. */
  restoredMobileSession: MobileMapSessionV1 | null;
};

/**
 * The shared answer. True when this Map arrival is already intentional and
 * first-run surfaces must stand down for it.
 */
export function explicitMapIntent(input: ExplicitMapIntentInput): boolean {
  return (
    searchHasExplicitMapIntent(input.search) ||
    input.planningIntent !== null ||
    restoredSessionHasExplicitIntent(input.restoredMobileSession)
  );
}
