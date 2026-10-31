// Map pin filtering for PubMap. Slim pins (prices: []) must stay visible through
// filters whose evidence exists only after detail hydrates.

import { anyAccessibilityFilterActive } from "@/lib/venueAccessibility";
import { filterVenues, type Filters, type Venue } from "@/lib/venues";

/**
 * Split venues into slim (no price rows yet) vs hydrated, and apply the right
 * filter cohort. Slim pins keep filters backed by slim hints or live signals.
 */
export function filterMapVenues(
  venues: readonly Venue[],
  filters: Filters,
  hasPintDrops: (venueId: string) => boolean,
  openNowState: (venueId: string) => boolean | "unknown" = () => "unknown",
): Venue[] {
  const slimPinFilters: Filters = {
    ...filters,
    canonicalOnly: false,
    requireNonAlcoholic: false,
    requireWater: false,
    requireHeritage: false,
    // Accessibility requires confirmed evidence even before detail hydrates.
    // openNow stays on for slim pins: match uses name+coords, which slim rows have.
  };

  const slim: Venue[] = [];
  const hydrated: Venue[] = [];
  for (const venue of venues) {
    // Slim pins are prices: [] — filterHints are still present on London slim
    // rows, so do NOT require !filterHints (that dead-ended the bypass).
    if (venue.prices.length === 0) slim.push(venue);
    else hydrated.push(venue);
  }

  return [
    ...filterVenues(slim, slimPinFilters, hasPintDrops, openNowState),
    ...filterVenues(hydrated, filters, hasPintDrops, openNowState),
  ];
}

/**
 * UK base pubs carry no sourced feature or accessibility evidence. Those
 * filters must hide the base layer rather than imply confirmed matches.
 */
export function mapFiltersSuspendUkBasePubs(filters: Filters): boolean {
  return Boolean(filters.lastOrders || filters.requireBeerGarden || filters.requireOutdoorSeating || filters.requireLiveSports || filters.requireDogFriendly || filters.requireDarts || filters.requirePool) || anyAccessibilityFilterActive({
    stepFree: filters.requireStepFree,
    accessibleToilet: filters.requireAccessibleToilet,
    seatedService: filters.requireSeatedService,
  });
}

/**
 * Keep a deep-linked / selected venue on the canvas even if filters exclude it.
 *
 * Returns `filtered` ITSELF whenever nothing has to be added. The canvas
 * rebuilds every pin's GeoJSON and re-sends the whole source to MapLibre's
 * worker in a layout effect keyed on this array's identity, so a fresh copy on
 * every selection put that rebuild inside the venue tap's own frame - the /map
 * INP tail. A tap on a pin that is already drawn changes nothing here.
 */
export function withForcedVenue(
  filtered: Venue[],
  allById: ReadonlyMap<string, Venue>,
  forcedId: string | null | undefined,
): Venue[] {
  const id = forcedId?.trim();
  if (!id) return filtered;
  if (filtered.some((venue) => venue.id === id)) return filtered;
  const forced = allById.get(id);
  if (!forced) return filtered;
  return [...filtered, forced];
}

/**
 * A list that keeps its identity while it holds the same members.
 *
 * Every read a venue sheet starts (its drops, its prices) rebuilds the venue
 * signals, and the filter pipeline re-runs on them. It almost always lets
 * through exactly the pins it let through before, but as a NEW array, so the
 * suggested crawl (a sort and score of every pub) and every memo keyed on the
 * list re-ran about a second after each tap (map-selection-inp).
 *
 * The answer always holds the input's members in the input's order; it is the
 * previous array only when that is already true, compared by reference so a
 * venue object replaced by a richer one still counts as a change. The held
 * value is a cache, so a render React discards can never make it wrong.
 */
export function createMemberStabilizer<T>(): (next: T[]) => T[] {
  let held: T[] | null = null;
  return (next) => {
    if (held && sameMembers(held, next)) return held;
    held = next;
    return next;
  };
}

function sameMembers<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
