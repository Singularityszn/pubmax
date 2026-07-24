// Map-originated Venue acceptance (trusted-handoff §4.8).
//
// Turning an inspected Venue into an accepted Stop 1 from the Map is the ONE
// place L05 writes a PlanningIntent. The write is gated by the caller on the
// intent-write flag; this module only builds the exact, minimal envelope and
// resolves the typed acceptance source, so both are unit-testable with no DOM.
//
// Honesty: a Map acceptance carries no accepted area or date yet (the server
// resolvePlanningAnchor recomputes the canonical Night Area, §4.3), and its
// evidence is the map directory listing, not a dated price. So area/date are
// null and evidence is "directory" with no observedAt — never invented.
//
// Server-safe: no window/DOM/React.

import type { CityId } from "@/lib/cities";
import type {
  PlanningIntentInput,
  PlanningIntentSource,
} from "@/lib/planningIntent";
import { PLANNING_INTENT_SOURCES } from "@/lib/planningIntent";

/** Valid PlanningIntent sources that a Map acceptance can legitimately carry. */
export function isPlanningIntentSource(
  value: string | null | undefined,
): value is PlanningIntentSource {
  return (
    typeof value === "string" &&
    (PLANNING_INTENT_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * The typed acceptance source seeded from an accepted-handoff arrival
 * (`?accept=1&src=<source>`). Only a valid, present source counts; a missing,
 * unknown, or accept-less arrival yields null (a later Map-search selection sets
 * "map-search" instead). Never guesses a source from the current UI.
 */
export function initialAcceptanceSource(search: string): PlanningIntentSource | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("accept") !== "1") return null;
  const src = params.get("src");
  return isPlanningIntentSource(src) ? src : null;
}

/**
 * Build the minimal, honest PlanningIntent envelope for a Map acceptance of
 * `acceptedVenueId` with a typed `source`. Area/date are null and evidence is
 * the undated map directory listing — the server re-derives the canonical area,
 * price, and freshness from the Venue id.
 */
export function buildMapAcceptanceIntentInput(input: {
  source: PlanningIntentSource;
  cityId: CityId;
  acceptedVenueId: string;
}): PlanningIntentInput {
  return {
    source: input.source,
    cityId: input.cityId,
    acceptedVenueId: input.acceptedVenueId,
    acceptedArea: null,
    startsAt: null,
    displayEvidence: { kind: "directory", observedAt: null },
  };
}
