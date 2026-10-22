import { listedServingGroup } from "@/lib/listedPriceComparison";
import { formatGbp } from "@/lib/formatGbp";
import { buildLogNearbyCandidates, type LogNearbyCandidate } from "@/lib/mapLogIntent";
import { haversineKm } from "@/lib/haversine";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";
import {
  drinkLensCoverageNote,
  drinkLensUnknownSentence,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { compactVenueAnchor } from "@/lib/venueAnchorPresentation";
import { isPubVenueKind } from "@/lib/venueKindFilters";

type MapVenueListVenueSignals = ReadonlyMap<
  string,
  { latestContributorPrice: number | null }
>;

// Accessibility contract (WCAG 2.1.1): WebGL pins are pointer-only. This is the
// pure model behind the DOM "List view", the keyboard-reachable parallel to
// the canvas. It reuses the existing nearby-picker builder so the list rows are
// the SAME shape (name + price + optional distance) the log-drop picker uses,
// and selection from a row drives the SAME select handler a pin tap does.

// Explicit limit available to deliberately bounded secondary views. Main map
// list does not apply it because every venue in view must remain operable.
export const MAP_VENUE_LIST_LIMIT = 60;

/** How List view orders the pubs currently in view. Default stays nearest. */
export type MapVenueListSortMode = "nearest" | "cheapest";

export type MapVenueListRow = LogNearbyCandidate & { lensPrice?: MapLensPrice; sortPrice?: number | null };

export type MapVenueListModel = {
  /**
   * Rows to render. Default order is nearest-first to the viewport centre when
   * known; "cheapest" ranks priced pubs ascending and leaves unpriced pubs last.
   */
  rows: MapVenueListRow[];
  /** Total venues currently on the map (pre-cap). */
  total: number;
  /** Rows actually shown (post-cap). */
  shown: number;
  /** True when the cap hid some of the on-map venues. */
  truncated: boolean;
  /**
   * What the selected drink's cross-venue read managed, or null when it
   * answered in full. This list is the DOM parallel to the pins, so it owes a
   * non-visual reader the same sentence the visual surfaces print: a read that
   * FAILED may never leave rows reading as a settled "none logged here".
   */
  coverageNote: string | null;
};

/**
 * The list is the DOM parallel to the unpriced pins, so it names what OSM
 * states: a bar reads as a bar. Neither kind carries a price.
 */
export type UkBasePubListRow = {
  id: string;
  name: string;
  priceLabel: string;
  distanceKm?: number;
  pub: UkBasePub;
  lensPrice?: MapLensPrice;
  sortPrice?: number | null;
};

export type UkBasePubListModel = {
  rows: UkBasePubListRow[];
  total: number;
  shown: number;
  truncated: boolean;
};

/**
 * Exact rendered membership for pitched and rotated maps.
 *
 * MapLibre's geographic bounds are the axis-aligned box around the rendered
 * quadrilateral, so its corners can name pubs that are actually off canvas.
 * The map supplies its own projection here instead. This reads coordinates
 * only and never queries rendered features or performs canvas hit-testing.
 */
export function projectedItemIdsInViewport<T extends { id: string }>(
  items: readonly T[],
  project: (item: T) => { x: number; y: number },
  viewport: { width: number; height: number },
): string[] {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return [];
  }
  return items.flatMap((item) => {
    let point: { x: number; y: number };
    try {
      point = project(item);
    } catch {
      return [];
    }
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > viewport.width ||
      point.y < 0 ||
      point.y > viewport.height
    ) {
      return [];
    }
    return [item.id];
  });
}

/**
 * Pint-default figure the list rows and pins share: map-authority contributor
 * price from venueSignals when present, else the curated cheapest. A bare
 * non-pub figure without complete provenance is not shown on the row.
 */
function mapVenueListPintPrice(
  venue: Venue,
  venueSignals: MapVenueListVenueSignals | null,
): number | null {
  if (!isPubVenueKind(venue.kind) && compactVenueAnchor(venue) === null) {
    return null;
  }
  const price =
    venueSignals?.get(venue.id)?.latestContributorPrice ?? venue.cheapestPrice ?? null;
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? price
    : null;
}

function mapVenueListPintPriceLabel(
  venue: Venue,
  venueSignals: MapVenueListVenueSignals | null,
): string {
  const price = mapVenueListPintPrice(venue, venueSignals);
  return price !== null ? formatGbp(price) : "Price TBD";
}

/**
 * The figure List view may rank on: an active drink lens uses that lens price
 * alone (same stack as AreaSheet), and the pint default mirrors pin authority
 * via venueSignals. A bare non-pub figure without complete provenance is not
 * shown on the row, so it cannot climb the cheapest sort.
 */
function comparableLensAmount(price: MapLensPrice | undefined, serving?: string | null, drinkSubtype?: string | null): number | null {
  if (!price || !Number.isFinite(price.priceGbp) || price.priceGbp <= 0) return null;
  // Experience-only legacy callers retain their own quantity contract. Selected
  // drink lanes always supply null or a chosen group, so unknown serves never rank.
  if (serving === undefined) return price.priceGbp;
  if (price.source !== "listed" || !price.category || !serving) return null;
  const selected = listedServingGroup(price.category, serving, drinkSubtype);
  return selected && listedServingGroup(price.category, price.servingSize, drinkSubtype) === selected ? price.priceGbp : null;
}

function byComparablePrice(left: { sortPrice?: number | null; name: string; id: string; distanceKm?: number },
  right: { sortPrice?: number | null; name: string; id: string; distanceKm?: number }): number {
  const a = left.sortPrice ?? null;
  const b = right.sortPrice ?? null;
  if (a !== null && b !== null) return a - b || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  if (a !== null) return -1;
  if (b !== null) return 1;
  return (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity)
    || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

/** One serving group ranks across both catalogues; base identity stays intact. */
export function combineMapVenueListRows(curated: readonly MapVenueListRow[], base: readonly UkBasePubListRow[],
  sortMode: MapVenueListSortMode): Array<MapVenueListRow | UkBasePubListRow> {
  const rows = [...curated, ...base];
  return sortMode === "cheapest" ? rows.sort(byComparablePrice) : rows.sort((a, b) =>
    (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Build the keyboard/AT-reachable list of the venues currently on the map.
 *
 * Default order is nearest-first to the viewport centre so the list mirrors
 * what the eye sees on the canvas; without a viewport fix it preserves the
 * filtered map order. "cheapest" ranks priced pubs ascending (active drink lens
 * when set) and leaves unpriced pubs last, nearest among themselves. Pure and
 * deterministic — safe on empty input.
 */
export function buildMapVenueListModel(
  venues: Venue[],
  viewportCenter: [number, number] | null,
  limit: number = venues.length,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  lensCategoryLabel: string = "this view",
  lensStatus: CategoryPriceIndexStatus = "ready",
  sortMode: MapVenueListSortMode = "nearest",
  venueSignals: MapVenueListVenueSignals | null = null,
  serving?: string | null,
  drinkSubtype?: string | null,
): MapVenueListModel {
  const total = venues.length;
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? { lng: viewportCenter[0], lat: viewportCenter[1] }
      : null;
  const baseRows = buildLogNearbyCandidates(venues, limit, origin);
  const venueById = new Map(venues.map((item) => [item.id, item]));
  const drinkNoun = lensCategoryLabel.toLowerCase();
  // A row is read on its own, so its unknown wording carries the finding too -
  // the note below is not always heard beside it.
  const unknownLabel = drinkLensUnknownSentence(drinkNoun, lensStatus);
  const labelledRows =
    lensPrices === null
      ? baseRows.map((row) => {
          const item = venueById.get(row.id);
          if (!item) return row;
          // A pub's figure wears its band; an anchor is not a pint and wears none.
          const pint = isPubVenueKind(item.kind) ? mapVenueListPintPrice(item, venueSignals) : null;
          return {
            ...row,
            priceLabel: mapVenueListPintPriceLabel(item, venueSignals),
            sortPrice: mapVenueListPintPrice(item, venueSignals),
            priceBand: priceBand(pint, priceBandAreaForVenue(item.id)),
          };
        })
      : baseRows.map((row) => {
          const lensPrice = lensPrices.get(row.id);
          return {
            ...row,
            ...(lensPrice ? { lensPrice } : {}),
            sortPrice: comparableLensAmount(lensPrice, serving, drinkSubtype),
            priceLabel: lensPrice
              ? `${lensPrice.categoryLabel} · ${formatGbp(lensPrice.priceGbp)}`
              : unknownLabel,
            priceBand:
              lensPrice && lensPrice.category === "beer"
                && (!drinkSubtype || (serving === "pint" && listedServingGroup("beer", lensPrice.servingSize, drinkSubtype) === "pint"))
                ? priceBand(lensPrice.priceGbp, priceBandAreaForVenue(row.id))
                : null,
          };
        });
  const rows = sortMode === "cheapest" ? [...labelledRows].sort(byComparablePrice) : labelledRows;
  return {
    rows,
    total,
    shown: rows.length,
    truncated: total > rows.length,
    coverageNote:
      lensPrices === null ? null : drinkLensCoverageNote(drinkNoun, lensStatus),
  };
}

export function buildUkBasePubListModel(
  pubs: UkBasePub[],
  viewportCenter: [number, number] | null,
  limit: number = pubs.length,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  sortMode: MapVenueListSortMode = "nearest",
  serving?: string | null,
  drinkSubtype?: string | null,
): UkBasePubListModel {
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? { lng: viewportCenter[0], lat: viewportCenter[1] }
      : null;
  const rows = pubs.map<UkBasePubListRow>((pub) => ({
    id: pub.id,
    name: pub.name,
    ...(lensPrices?.get(pub.id) ? { lensPrice: lensPrices.get(pub.id),
      sortPrice: comparableLensAmount(lensPrices.get(pub.id), serving, drinkSubtype) } : {}),
    priceLabel: lensPrices?.get(pub.id)
      ? `${lensPrices.get(pub.id)!.categoryLabel} · ${formatGbp(lensPrices.get(pub.id)!.priceGbp)}`
      : pub.kind === "bar"
        ? "Other bar · no listed price"
        : "Other pub · no listed price",
    ...(origin
      ? { distanceKm: haversineKm([origin.lng, origin.lat], [pub.lng, pub.lat]) }
      : {}),
    pub,
  }));
  if (origin) {
    rows.sort(
      (left, right) =>
        (left.distanceKm ?? Number.POSITIVE_INFINITY) -
          (right.distanceKm ?? Number.POSITIVE_INFINITY) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
  }
  if (sortMode === "cheapest") rows.sort(byComparablePrice);
  const bounded = rows.slice(0, Math.max(0, Math.floor(limit)));
  return {
    rows: bounded,
    total: pubs.length,
    shown: bounded.length,
    truncated: pubs.length > bounded.length,
  };
}
