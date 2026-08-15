import { haversineKm } from "@/lib/haversine";
import { namedLegacyPintPriceSource } from "@/lib/drinks";
import { NIGHT_AREAS, type NightArea } from "@/lib/nightAreas";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import type { Venue } from "@/lib/venues";

// One seam for every governed priced landing page. The drink-brand family and
// the brand-by-area family are two views of one contract, so the cheapest-first
// order, the publication floors, the "null means unpublishable" rule, the
// publisher disclosure and the JSON-LD shape live here once. A second copy of
// any of them is how two pages come to answer one question two ways.

/** The ONE publisher resolver every priced landing row shares. */
export type PricedLandingPublisher = NonNullable<
  ReturnType<typeof namedLegacyPintPriceSource>
>;

export type PricedLandingRow = {
  rank: number;
  venueId: string;
  venueName: string;
  borough: string;
  pintName: string;
  priceGbp: number;
  publisher: PricedLandingPublisher | null;
};

/** A candidate row before ranking. Rank is assigned by this module alone. */
export type PricedLandingCandidate = Omit<PricedLandingRow, "rank">;

/** Every published family and the floor it must clear. One table, no drift. */
export const PRICED_LANDING_PUBLICATION_FLOORS = {
  "drink-brand": 20,
  "drink-brand-area": 10,
} as const;

export type PricedLandingFamily = keyof typeof PRICED_LANDING_PUBLICATION_FLOORS;

/** Rows a page may print. A page never prints more than it can rank honestly. */
export const PRICED_LANDING_ROW_LIMIT = 20;

/** Cheapest first, then name, then id, so one dataset gives one order. */
export function comparePricedLandingRows(
  left: PricedLandingCandidate,
  right: PricedLandingCandidate,
): number {
  return (
    left.priceGbp - right.priceGbp ||
    left.venueName.localeCompare(right.venueName) ||
    left.venueId.localeCompare(right.venueId)
  );
}

export type PublishablePricedRows = {
  /** Every candidate that cleared the floor, not only the printed ones. */
  totalPricedVenues: number;
  rows: [PricedLandingRow, ...PricedLandingRow[]];
};

/**
 * The one place "not publishable" is decided. `null` means no page exists, so
 * the route, generateStaticParams and the sitemap cannot disagree.
 */
export function publishablePricedRows(
  family: PricedLandingFamily,
  candidates: readonly PricedLandingCandidate[],
  limit = PRICED_LANDING_ROW_LIMIT,
): PublishablePricedRows | null {
  // One pub counts once, at its cheapest row. Sorting before the dedupe makes
  // that independent of the order the candidates arrived in, and it keeps the
  // floor honest: a pub listed twice must never buy a page.
  const cheapestPerVenue = new Map<string, PricedLandingCandidate>();
  for (const candidate of [...candidates].sort(comparePricedLandingRows)) {
    if (!cheapestPerVenue.has(candidate.venueId)) {
      cheapestPerVenue.set(candidate.venueId, candidate);
    }
  }

  const ranked = [...cheapestPerVenue.values()];
  if (ranked.length < PRICED_LANDING_PUBLICATION_FLOORS[family]) return null;

  const rows = ranked
    .slice(0, limit)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const [firstRow, ...restRows] = rows;
  if (!firstRow) return null;

  return {
    totalPricedVenues: ranked.length,
    rows: [firstRow, ...restRows],
  };
}

/** Publisher disclosure copy. `docs/VOICE.md` governs both sentences. */
export function formatPricedLandingPublisherStatus(
  publisher: PricedLandingPublisher | null,
): string {
  return publisher ? `Publisher: ${publisher.label}` : "Publisher not recorded";
}

/** Says how many of the priced pubs a page is actually showing. */
export function pricedLandingCountLabel(
  totalPricedVenues: number,
  shownRowCount: number,
): string {
  return totalPricedVenues > shownRowCount
    ? `Showing ${shownRowCount} of ${totalPricedVenues} pubs`
    : `${totalPricedVenues} pubs`;
}

function validVenuePoint(venue: Venue): boolean {
  return Number.isFinite(venue.latitude) && Number.isFinite(venue.longitude);
}

// One venue is assigned to one area for the life of a process. Without the memo
// the assignment is recomputed per venue per (area x brand) pair, which is
// roughly 1.5M haversines for one sitemap request.
const areaAssignments = new WeakMap<
  readonly NightArea[],
  Map<string, NightArea | null>
>();

/** Assign one venue to its nearest containing area across the supplied catalogue. */
export function assignVenueToNightArea(
  venue: Venue,
  areas: readonly NightArea[] = NIGHT_AREAS,
): NightArea | null {
  let cached = areaAssignments.get(areas);
  if (!cached) {
    cached = new Map();
    areaAssignments.set(areas, cached);
  }
  const held = cached.get(venue.id);
  if (held !== undefined) return held;

  const assigned = !validVenuePoint(venue)
    ? null
    : areas
        .map((area) => ({
          area,
          distanceKm: haversineKm(
            [venue.longitude, venue.latitude],
            [area.centre.lng, area.centre.lat],
          ),
        }))
        .filter(({ area, distanceKm }) => distanceKm <= area.radiusKm)
        .sort(
          (left, right) =>
            left.distanceKm - right.distanceKm ||
            left.area.slug.localeCompare(right.area.slug),
        )[0]?.area ?? null;

  cached.set(venue.id, assigned);
  return assigned;
}

/**
 * Whether an area may carry an INDEXED price page.
 *
 * Deliberately narrower than `isNightAreaRouteReady`, which also expires with
 * the area's route review (`reviewExpiresAt`). Route readiness governs PLANNING
 * a crawl: unchecked transport and opening hours must stop a route. A priced
 * list is not a route. It carries its own collection date, so letting a review
 * window lapse would 404 URLs already in the sitemap and deindex them, which is
 * a worse answer than a price list somebody last reviewed a while ago. The
 * renewal alarm lives in `__tests__/nightAreaReviewRenewal.test.ts`.
 */
export function nightAreaPublishesPrices(area: NightArea): boolean {
  return (
    area.coverageStatus === "route_ready" &&
    area.missingEvidence.length === 0 &&
    area.gate.passed &&
    Boolean(area.lastReviewedAt)
  );
}

export type PricedLandingJsonLdNode = {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList" | "ItemList";
  name?: string;
  numberOfItems?: number;
  itemListOrder?: string;
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item?: string;
    url?: string;
  }>;
};

/** One JSON-LD shape for every priced landing page. */
export function pricedLandingJsonLd(input: {
  breadcrumb: ReadonlyArray<{ name: string; path: string }>;
  listName: string;
  rows: readonly PricedLandingRow[];
}): PricedLandingJsonLdNode[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: input.breadcrumb.map((crumb, index) => ({
        "@type": "ListItem" as const,
        position: index + 1,
        name: crumb.name,
        item: `${PRODUCTION_SITE_ORIGIN}${crumb.path}`,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: input.listName,
      numberOfItems: input.rows.length,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: input.rows.map((row) => ({
        "@type": "ListItem" as const,
        position: row.rank,
        name: row.venueName,
        url: `${PRODUCTION_SITE_ORIGIN}/ledger/${encodeURIComponent(row.venueId)}`,
      })),
    },
  ];
}
