// The area root page, /area/{slug}: the cheapest listed pints in one London
// Night Area (SEO audit #2126, finding 17; captain, 30 Oct 2026). It publishes
// when the area holds PRICED_LANDING_PUBLICATION_FLOORS.area priced pubs, and
// on that floor alone: a price list is not a route, so the route-readiness
// review (`nightAreaPublishesPrices`) that gates the brand-by-area pairs does
// not gate it. Everything else follows the governed landing contract in
// docs/specs/governed-priced-landings/PRODUCT.md: rows come from the exact
// price row that owns them, one pub counts once at its cheapest row, and an
// area below the floor has no page.

import { legacyPintPriceObservedAt, namedLegacyPintPriceSource, oldestPintRead } from "@/lib/drinks";
import { getNightAreasForCity, type NightArea, type NightAreaSlug } from "@/lib/nightAreas";
import {
  assignVenueToNightArea,
  publishablePricedRows,
  type PricedLandingCandidate,
  type PricedLandingRow,
} from "@/lib/pricedLanding";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import type { Venue, VenuePrice } from "@/lib/venues";

export type AreaLanding = {
  areaSlug: NightAreaSlug;
  areaName: string;
  transportAnchors: readonly string[];
  /** The oldest read among the rows the page prints; null when any of them records none. */
  collectedAt: string | null;
  totalPricedVenues: number;
  rows: [PricedLandingRow, ...PricedLandingRow[]];
};

function cheapestPintRow(venue: Venue): VenuePrice | null {
  let best: VenuePrice | null = null;
  for (const row of venue.prices) {
    const price = row.price_gbp;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    if (!best || price < (best.price_gbp as number)) best = row;
  }
  return best;
}

/** One pub's candidate row for the area page: its own cheapest listed pint. */
export function areaCandidateForVenue(venue: Venue): PricedLandingCandidate | null {
  if (!isPublicRankablePub(venue)) return null;
  const row = cheapestPintRow(venue);
  if (!row || typeof row.price_gbp !== "number") return null;
  return {
    venueId: venue.id,
    venueName: venue.name,
    borough: venue.primaryBorough,
    pintName: row.pint_name,
    priceGbp: row.price_gbp,
    publisher: namedLegacyPintPriceSource(row),
    observedAt: legacyPintPriceObservedAt(row),
  };
}

function landingFor(area: NightArea, venues: readonly Venue[]): AreaLanding | null {
  const candidates = venues.flatMap((venue) => {
    if (assignVenueToNightArea(venue)?.slug !== area.slug) return [];
    const candidate = areaCandidateForVenue(venue);
    return candidate ? [candidate] : [];
  });
  const published = publishablePricedRows("area", candidates);
  if (!published) return null;
  return {
    areaSlug: area.slug,
    areaName: area.name,
    transportAnchors: area.transportAnchors,
    collectedAt: oldestPintRead(published.rows.map((row) => row.observedAt)),
    totalPricedVenues: published.totalPricedVenues,
    rows: published.rows,
  };
}

/** The London area page for one slug, or null when the area has no page. */
export function buildAreaLanding(slug: string, venues: readonly Venue[]): AreaLanding | null {
  const area = getNightAreasForCity("london").find((candidate) => candidate.slug === slug);
  return area ? landingFor(area, venues) : null;
}

/** Every London area page that publishes, in catalogue order. */
export function listAreaLandings(venues: readonly Venue[]): AreaLanding[] {
  return getNightAreasForCity("london").flatMap((area) => {
    const landing = landingFor(area, venues);
    return landing ? [landing] : [];
  });
}

export function areaLandingRoute(slug: string): `/area/${string}` {
  return `/area/${encodeURIComponent(slug)}`;
}
