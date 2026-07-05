import type { Venue } from "@/lib/venues";

// Pure ranking helpers over grouped Venue[] for the /discover leaderboard.
// No fetch, no React, no side effects — everything here is a plain transform so
// it can be unit-tested directly (see __tests__/leaderboard.test.ts).

// A venue that carries a usable (non-null) cheapest price. Narrowing to this
// shape lets callers treat `cheapestPrice` as a number without re-checking.
export type PricedVenue = Venue & { cheapestPrice: number };

// A venue paired with its rank + area, ready to hand straight to the table.
export type LeaderboardEntry = {
  rank: number;
  venue: PricedVenue;
  area: string;
};

// The fallback area label used when a venue has no borough/area field at all.
export const UNKNOWN_AREA = "Greater London";

// We group by `primaryBorough` because it is the app's canonical area field:
// the dataset fills it for all but a handful of rows (29 distinct London
// boroughs), and it already drives the map's borough context. When a venue has
// no primaryBorough we fall back to the first visibleBorough, then to a coarse
// UNKNOWN_AREA bucket — so a sparse row is grouped, never dropped.
export function venueArea(venue: Venue): string {
  const primary = venue.primaryBorough?.trim();
  if (primary) return primary;
  const visible = venue.visibleBoroughs.find((borough) => borough.trim());
  if (visible) return visible.trim();
  return UNKNOWN_AREA;
}

function hasPrice(venue: Venue): venue is PricedVenue {
  return typeof venue.cheapestPrice === "number";
}

// Cheapest priced venues, ascending. Venues with a null cheapestPrice are
// dropped entirely (they can't be ranked on price). Ties break on name so the
// order is deterministic across renders. `limit` caps the returned list.
export function cheapestPints(venues: Venue[], limit = 10): LeaderboardEntry[] {
  return venues
    .filter(hasPrice)
    .sort(
      (a, b) =>
        a.cheapestPrice - b.cheapestPrice || a.name.localeCompare(b.name),
    )
    .slice(0, Math.max(0, limit))
    .map((venue, index) => ({
      rank: index + 1,
      venue,
      area: venueArea(venue),
    }));
}

// The single cheapest priced venue in each area. Venues with no price are
// ignored; areas with no priced venue don't appear. The result is sorted by
// price ascending so the cheapest areas lead. Ties break on area name.
export function cheapestByArea(venues: Venue[]): LeaderboardEntry[] {
  const cheapestPerArea = new Map<string, PricedVenue>();

  for (const venue of venues) {
    if (!hasPrice(venue)) continue;
    const area = venueArea(venue);
    const current = cheapestPerArea.get(area);
    if (
      !current ||
      venue.cheapestPrice < current.cheapestPrice ||
      (venue.cheapestPrice === current.cheapestPrice &&
        venue.name.localeCompare(current.name) < 0)
    ) {
      cheapestPerArea.set(area, venue);
    }
  }

  return Array.from(cheapestPerArea.entries())
    .map(([area, venue]) => ({ area, venue, rank: 0 }))
    .sort(
      (a, b) =>
        a.venue.cheapestPrice - b.venue.cheapestPrice ||
        a.area.localeCompare(b.area),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
