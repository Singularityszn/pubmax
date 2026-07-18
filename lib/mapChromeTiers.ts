// Map-chrome tier model (the #352 consolidation verdict, implemented).
//
// At full merge the mobile map was headed for SEVEN peer chips on 390px —
// instrument-panel, not answer. This module is the single source of truth for
// what sits where, so the shell renders hierarchy instead of a flat rail:
//
//   TIER 1  Near me            — THE answer; the only primary-weight chip.
//   TIER 2  Tonight, Filters   — answer-adjacent surfaces; Filters absorbs the
//                                old Drinks + price chips (both always opened
//                                the same sheet) and, when the zone lens lands,
//                                the Zone picker (its sheet section already
//                                exists there on that branch).
//   TIER 3  TfL (+ List later) — utilities; compact corner icon-buttons with
//                                badges, out of the answer's way.
//
// Pure and render-free so the hierarchy is unit-testable; the shell just maps
// descriptors to components. Adoption notes for the in-flight chip PRs live in
// docs/MAP_CHROME_TIERS.md.

export type NearMeStatus = "idle" | "requesting" | "ready" | "error";
export type TflStatus = "checking" | "clear" | "issues" | "unavailable";

export type PrimaryChipModel = {
  label: string;
  disabled: boolean;
  pressed: boolean;
};

export type FiltersChipModel = {
  label: "Filters";
  /** Number of active refinement groups (drinks, price cap, zone later). */
  refinements: number;
  /** Screen-reader detail, e.g. "Filters — drinks and ≤£8.00 active". */
  ariaLabel: string;
};

export type CornerUtilityModel = {
  id: "tfl";
  /** Compact status suffix rendered beside the icon ("OK", "?", or null). */
  statusSuffix: string | null;
  badge: number | null;
  ariaLabel: string;
};

export function buildNearMeChip(status: NearMeStatus, nearbyCount: number): PrimaryChipModel {
  return {
    label:
      status === "requesting"
        ? "Locating"
        : status === "ready"
          ? `Nearby ${nearbyCount}`
          : status === "error"
            ? "Try near me"
            : "Near me",
    disabled: status === "requesting",
    pressed: status === "ready",
  };
}

export function buildFiltersChip(input: {
  drinkFiltersActive: boolean;
  priceCapActive: boolean;
  priceLabel: string;
  /** #329 adoption: the zone lens filter counts as a third refinement. */
  zoneActive?: boolean;
}): FiltersChipModel {
  const refinements =
    (input.drinkFiltersActive ? 1 : 0) + (input.priceCapActive ? 1 : 0) + (input.zoneActive ? 1 : 0);
  const parts: string[] = [];
  if (input.drinkFiltersActive) parts.push("drinks");
  if (input.priceCapActive) parts.push(input.priceLabel);
  if (input.zoneActive) parts.push("zone");
  return {
    label: "Filters",
    refinements,
    ariaLabel: refinements === 0 ? "Filters" : `Filters: ${parts.join(" and ")} active`,
  };
}

export function buildTflCorner(status: TflStatus, count: number): CornerUtilityModel {
  const statusSuffix = status === "clear" ? "OK" : status === "unavailable" ? "?" : null;
  return {
    id: "tfl",
    statusSuffix,
    badge: count > 0 ? count : null,
    ariaLabel:
      status === "clear"
        ? "TfL live: lines running well"
        : status === "unavailable"
          ? "TfL live: status unavailable"
          : count > 0
            ? `TfL live: ${count} updates`
            : "TfL live",
  };
}
