// Map-chrome tier model (the #352 consolidation verdict, implemented).
//
// At full merge the mobile map was headed for SEVEN peer chips on 390px —
// instrument-panel, not answer. This module is the single source of truth for
// what sits where, so the shell renders hierarchy instead of a flat rail:
//
//   TIER 1  Near me            — THE answer; a round map-edge FAB, the map's
//                                one primary action.
//   TIER 2  Filters            — one icon-button in the single top bar. It
//                                absorbs the old Drinks + price chips (both
//                                always opened the same sheet), the zone
//                                picker, and the venue-type toggles.
//   TIER 3  TfL               — compact corner icon-button with badges, out of
//                                the answer's way. List lives in Layers.
//
// Tonight's placement and empty-state policy belong to buildTonightChip below.
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

export type TonightChipModel = {
  label: "On tonight";
  count: number;
  /** Screen-reader detail, e.g. "On tonight: 3 listings" or "... near you". */
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
  /** Dedicated experience view, named separately from drink filters. */
  experienceLabel?: "no-alcohol view" | "food view";
  /** Phone Filters sheet: Saved only is on (same field as the desktop rail). */
  savedOnlyActive?: boolean;
  /** Open now is on (known-closed pubs dropped; unknown hours stay). */
  openNowActive?: boolean;
}): FiltersChipModel {
  const refinements =
    (input.drinkFiltersActive ? 1 : 0) +
    (input.priceCapActive ? 1 : 0) +
    (input.zoneActive ? 1 : 0) +
    (input.experienceLabel ? 1 : 0) +
    (input.savedOnlyActive ? 1 : 0) +
    (input.openNowActive ? 1 : 0);
  const parts: string[] = [];
  if (input.experienceLabel) parts.push(input.experienceLabel);
  if (input.drinkFiltersActive) parts.push("drinks");
  if (input.priceCapActive) parts.push(input.priceLabel);
  if (input.zoneActive) parts.push("zone");
  if (input.savedOnlyActive) parts.push("saved only");
  if (input.openNowActive) parts.push("open now");
  return {
    label: "Filters",
    refinements,
    ariaLabel: refinements === 0 ? "Filters" : `Filters: ${parts.join(" and ")} active`,
  };
}

/**
 * TfL's LIVE disruptions, the ones in effect now (lib/tflDisruption.ts:
 * 1 Closed, 2 Suspended, 3 Part Suspended, 6 Severe Delays).
 */
const URGENT_TUBE_STATUSES = new Set(["closed", "suspended", "part suspended", "severe delays"]);

/**
 * A tube line the reader should hear about before they set out: a live
 * disruption, not a line simply running slowly. Minor delays, the PLANNED
 * closures (Planned Closure, Part Closure and Part Closed, the overnight and
 * weekend works every line has) and "Service Closed" (every line that has
 * finished for the night) are in the sheet, not on the map.
 */
export function isUrgentTubeStatus(status: string | undefined): boolean {
  return (status ?? "")
    .split(",")
    .some((part) => URGENT_TUBE_STATUSES.has(part.trim().toLowerCase()));
}

/**
 * The map-edge TfL control. Its badge answers one question, whether anything
 * is urgent, so a resting map of four routine updates shows a bare glyph. The
 * full count stays in the accessible name and in the sheet it opens.
 */
export function buildTflCorner(
  status: TflStatus,
  count: number,
  urgentCount = 0,
): CornerUtilityModel {
  const statusSuffix = status === "clear" ? "OK" : status === "unavailable" ? "?" : null;
  const urgent = status === "issues" && urgentCount > 0 ? urgentCount : 0;
  return {
    id: "tfl",
    statusSuffix,
    badge: urgent > 0 ? urgent : null,
    ariaLabel:
      status === "clear"
        ? "TfL live: lines running well"
        : status === "unavailable"
          ? "TfL live: status unavailable"
          : urgent > 0
            ? `TfL live: ${urgent} ${urgent === 1 ? "line" : "lines"} badly disrupted, ${count} updates`
            : count > 0
              ? `TfL live: ${count} updates`
              : "TfL live",
  };
}

/**
 * Cold-start Tonight entry for the phone map. Honest empty: no lens when the
 * What's On spine has nothing to show, so a quiet night never advertises a
 * dead door. It heads the phone Filters sheet, never the resting map.
 */
export function buildTonightChip(
  rowCount: number,
  nearReader: boolean,
): TonightChipModel | null {
  if (!Number.isFinite(rowCount) || rowCount <= 0) return null;
  const count = Math.floor(rowCount);
  const nearSuffix = nearReader ? " near you" : "";
  return {
    label: "On tonight",
    count,
    ariaLabel:
      count === 1
        ? `On tonight: 1 listing${nearSuffix}`
        : `On tonight: ${count} listings${nearSuffix}`,
  };
}
