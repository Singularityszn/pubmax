import type { Venue } from "@/lib/venues";

// "Then vs Now" — connect a venue's baseline dataset price ("then") to the most
// recent community-reported Pint Drop price ("now"). Pure/testable: no fetch, no
// React, no side effects. The /discover page feeds it grouped Venue[] plus the
// public drops from GET /api/pint-drops and renders the result.

// The minimal community-drop shape computeThenVsNow reads. The public
// /api/pint-drops DTO satisfies this (it carries venueId, priceGbp, createdAt);
// callers narrow the API payload to this before passing it in.
export type ThenVsNowDrop = {
  venueId: string;
  priceGbp: number | null;
  createdAt: string;
};

// One resolved comparison row, ready to hand straight to a card.
// - thenGbp  = the venue's baseline/dataset cheapest price
// - nowGbp   = the price on the most-recent priced community drop for that venue
// - deltaGbp = nowGbp - thenGbp (positive → gone up, negative → gone down)
// - pct      = deltaGbp / thenGbp * 100 (0 when thenGbp is 0, guarded)
export type ThenVsNowItem = {
  venueId: string;
  venueName: string;
  thenGbp: number;
  nowGbp: number;
  deltaGbp: number;
  pct: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// The most-recent priced drop for a venue: filter to drops carrying a usable
// price, then pick the newest by createdAt (ISO strings sort lexicographically).
// Returns null when the venue has no priced community drop at all.
function mostRecentPricedDrop(drops: ThenVsNowDrop[]): ThenVsNowDrop | null {
  let best: ThenVsNowDrop | null = null;
  for (const drop of drops) {
    if (!isFiniteNumber(drop.priceGbp)) continue;
    if (!best || drop.createdAt.localeCompare(best.createdAt) > 0) best = drop;
  }
  return best;
}

// Build the "Then vs Now" rows. A venue only qualifies when it carries BOTH
// signals: a baseline `cheapestPrice` ("then") AND at least one priced community
// drop ("now"). Venues missing either are silently ignored.
//
// Ranking: biggest movers first — by absolute delta descending (the drops that
// tell the most striking price story lead), ties broken on venue name so the
// order is deterministic across renders. `limit` caps the returned list.
export function computeThenVsNow(
  venues: Venue[],
  drops: ThenVsNowDrop[],
  limit = 8,
): ThenVsNowItem[] {
  // Bucket drops by venue once so each venue is a single Map read.
  const byVenue = new Map<string, ThenVsNowDrop[]>();
  for (const drop of drops) {
    const key = drop.venueId;
    if (!key) continue;
    byVenue.set(key, [...(byVenue.get(key) ?? []), drop]);
  }

  const items: ThenVsNowItem[] = [];
  for (const venue of venues) {
    const thenGbp = venue.cheapestPrice;
    if (!isFiniteNumber(thenGbp)) continue; // no "then" baseline → skip

    const now = mostRecentPricedDrop(byVenue.get(venue.id) ?? []);
    if (!now || !isFiniteNumber(now.priceGbp)) continue; // no "now" community price → skip

    const nowGbp = now.priceGbp;
    const deltaGbp = nowGbp - thenGbp;
    const pct = thenGbp !== 0 ? (deltaGbp / thenGbp) * 100 : 0;

    items.push({
      venueId: venue.id,
      venueName: venue.name,
      thenGbp,
      nowGbp,
      deltaGbp,
      pct,
    });
  }

  return items
    .sort(
      (a, b) =>
        Math.abs(b.deltaGbp) - Math.abs(a.deltaGbp) ||
        a.venueName.localeCompare(b.venueName),
    )
    .slice(0, Math.max(0, limit));
}
