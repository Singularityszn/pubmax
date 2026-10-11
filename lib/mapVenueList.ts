import { formatGbp } from "@/lib/formatGbp";
import { buildLogNearbyCandidates, type LogNearbyCandidate } from "@/lib/mapLogIntent";
import { haversineKm } from "@/lib/haversine";
import type { LondonVenue } from "@/lib/londonVenueShards";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";
import {
  drinkLensCoverageNote,
  drinkLensUnknownSentence,
  type CategoryPriceIndexStatus,
  type MapLensPrice,
} from "@/lib/mapExperienceLens";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { compactVenueAnchor, type CompactVenueAnchor } from "@/lib/venueAnchorPresentation";
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

export type MapVenueListModel = {
  /**
   * Rows to render. Default order is nearest-first to the viewport centre when
   * known; "cheapest" ranks priced pubs ascending and leaves unpriced pubs last.
   */
  rows: LogNearbyCandidate[];
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
type UkBasePubListLabel =
  | "Other pub · no listed price"
  | "Other bar · no listed price";

type UkBasePubListRow = {
  id: string;
  name: string;
  priceLabel: UkBasePubListLabel;
  distanceKm?: number;
  pub: UkBasePub;
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

/**
 * A lens figure as a row wears it. A sourced anchor's figure is the anchor's
 * own, so it wears the anchor (whose label already names it) over the bare
 * figure. Any other lens figure wears the drink it is for, "<category> · £X",
 * and no anchor, because the anchor's label and source are not its evidence.
 */
export function mapVenueListLensPrice(
  lensPrice: MapLensPrice,
  anchor: CompactVenueAnchor | null,
): { priceLabel: string; anchor: CompactVenueAnchor | null } {
  if (lensPrice.source === "sourced-anchor" && anchor) {
    return { priceLabel: formatGbp(lensPrice.priceGbp), anchor };
  }
  return {
    priceLabel: `${lensPrice.categoryLabel} · ${formatGbp(lensPrice.priceGbp)}`,
    anchor: null,
  };
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
function mapVenueListSortPrice(
  venue: Venue,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  venueSignals: MapVenueListVenueSignals | null = null,
): number | null {
  if (lensPrices !== null) {
    const price = lensPrices.get(venue.id)?.priceGbp;
    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? price
      : null;
  }
  return mapVenueListPintPrice(venue, venueSignals);
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
            priceBand: priceBand(pint, priceBandAreaForVenue(item.id)),
          };
        })
      : baseRows.map((row) => {
          const lensPrice = lensPrices.get(row.id);
          return {
            ...row,
            ...(lensPrice
              ? mapVenueListLensPrice(lensPrice, row.anchor)
              : { priceLabel: unknownLabel, anchor: null }),
            priceBand:
              lensPrice && lensPrice.category === "beer"
                ? priceBand(lensPrice.priceGbp, priceBandAreaForVenue(row.id))
                : null,
          };
        });
  const rows =
    sortMode === "cheapest"
      ? sortMapVenueListRowsCheapest(
          labelledRows,
          venues,
          lensPrices,
          venueSignals,
        )
      : labelledRows;
  return {
    rows,
    total,
    shown: rows.length,
    truncated: total > rows.length,
    coverageNote:
      lensPrices === null ? null : drinkLensCoverageNote(drinkNoun, lensStatus),
  };
}

function sortMapVenueListRowsCheapest(
  rows: LogNearbyCandidate[],
  venues: Venue[],
  lensPrices: ReadonlyMap<string, MapLensPrice> | null,
  venueSignals: MapVenueListVenueSignals | null,
): LogNearbyCandidate[] {
  const venueById = new Map(venues.map((venue) => [venue.id, venue]));
  return [...rows].sort((left, right) => {
    const leftVenue = venueById.get(left.id);
    const rightVenue = venueById.get(right.id);
    const leftPrice = leftVenue
      ? mapVenueListSortPrice(leftVenue, lensPrices, venueSignals)
      : null;
    const rightPrice = rightVenue
      ? mapVenueListSortPrice(rightVenue, lensPrices, venueSignals)
      : null;
    if (leftPrice !== null && rightPrice !== null) {
      return compareCheapest(left, leftPrice, right, rightPrice);
    }
    if (leftPrice !== null) return -1;
    if (rightPrice !== null) return 1;
    return (
      (left.distanceKm ?? Number.POSITIVE_INFINITY) -
        (right.distanceKm ?? Number.POSITIVE_INFINITY) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id)
    );
  });
}

/** The cheapest order between two priced entries: price, then name, then id. */
function compareCheapest(
  left: { name: string; id: string },
  leftPrice: number,
  right: { name: string; id: string },
  rightPrice: number,
): number {
  return (
    leftPrice - rightPrice ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * The venue in view that List view's "cheapest" order puts first, with the
 * figure it ranked on. It reads the list's own sort price and comparator, so
 * the peek answer and the first row of the list can never disagree: a non-pub
 * anchor with complete provenance ranks here exactly as it ranks there. Null
 * when nothing in view carries a price.
 */
export function mapVenueListCheapest(
  venues: readonly Venue[],
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
  venueSignals: MapVenueListVenueSignals | null = null,
): { venue: Venue; priceGbp: number } | null {
  let best: { venue: Venue; priceGbp: number } | null = null;
  for (const venue of venues) {
    const priceGbp = mapVenueListSortPrice(venue, lensPrices, venueSignals);
    if (priceGbp === null) continue;
    if (best === null || compareCheapest(venue, priceGbp, best.venue, best.priceGbp) < 0) {
      best = { venue, priceGbp };
    }
  }
  return best;
}

export function buildUkBasePubListModel(
  pubs: UkBasePub[],
  viewportCenter: [number, number] | null,
  limit: number = pubs.length,
): UkBasePubListModel {
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? { lng: viewportCenter[0], lat: viewportCenter[1] }
      : null;
  // An unnamed pub is a bare pin, not a row: a list of "Pub" repeated down a
  // street says nothing a reader can act on.
  const listed = pubs.filter((pub) => !pub.unnamed);
  const rows = listed.map<UkBasePubListRow>((pub) => ({
    id: pub.id,
    name: pub.name,
    priceLabel:
      pub.kind === "bar"
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
  const bounded = rows.slice(0, Math.max(0, Math.floor(limit)));
  return {
    rows: bounded,
    total: listed.length,
    shown: bounded.length,
    truncated: listed.length > bounded.length,
  };
}

type LondonRestaurantListRow = {
  id: string;
  name: string;
  priceLabel: "Restaurant · no listed price";
  distanceKm?: number;
};

/** The DOM parallel to the London restaurant pins (lib/londonRestaurants.ts). */
export type LondonRestaurantListModel = {
  rows: LondonRestaurantListRow[];
  total: number;
  shown: number;
  truncated: boolean;
};

/**
 * The restaurants the canvas has in view, nearest the viewport centre first,
 * on the deal `buildUkBasePubListModel` takes: a real row for every restaurant
 * pin, so a keyboard or screen-reader user can reach each one. A restaurant
 * carries no price, so the row says so rather than borrowing one.
 */
export function buildLondonRestaurantListModel(
  restaurants: readonly LondonVenue[],
  viewportCenter: [number, number] | null,
  limit: number = restaurants.length,
): LondonRestaurantListModel {
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? viewportCenter
      : null;
  const rows = restaurants.map<LondonRestaurantListRow>((restaurant) => ({
    id: restaurant.id,
    name: restaurant.name,
    priceLabel: "Restaurant · no listed price",
    ...(origin
      ? { distanceKm: haversineKm(origin, [restaurant.lng, restaurant.lat]) }
      : {}),
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
  const bounded = rows.slice(0, Math.max(0, Math.floor(limit)));
  return {
    rows: bounded,
    total: restaurants.length,
    shown: bounded.length,
    truncated: restaurants.length > bounded.length,
  };
}

/**
 * One answer for List view's groups (priced venues, base pubs, restaurants):
 * the counts the header prints, and the first row, which takes focus when the
 * list opens. Row ids are unique across groups, so the first row of the first
 * non-empty group is the one.
 */
export function summarizeListGroups(
  groups: readonly {
    rows: readonly { id: string }[];
    total: number;
    shown: number;
    truncated: boolean;
  }[],
): { total: number; shown: number; truncated: boolean; firstRowId: string | undefined } {
  return {
    total: groups.reduce((sum, group) => sum + group.total, 0),
    shown: groups.reduce((sum, group) => sum + group.shown, 0),
    truncated: groups.some((group) => group.truncated),
    firstRowId: groups.find((group) => group.rows.length > 0)?.rows[0]?.id,
  };
}
