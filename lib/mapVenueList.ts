import { buildLogNearbyCandidates, type LogNearbyCandidate } from "@/lib/mapLogIntent";
import { haversineKm } from "@/lib/haversine";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";
import type { MapLensPrice } from "@/lib/mapExperienceLens";

// A11Y finding #1 (WCAG 2.1.1): the WebGL pins are pointer-only, so a keyboard
// or screen-reader user can never enumerate/open an arbitrary pin. This is the
// pure model behind the DOM "List view" — the keyboard-reachable parallel to
// the canvas. It reuses the existing nearby-picker builder so the list rows are
// the SAME shape (name + price + optional distance) the log-drop picker uses,
// and selection from a row drives the SAME select handler a pin tap does.

// Keep the list scannable — the map can hold hundreds of pins, but an
// unbounded DOM list is neither usable nor performant to render.
export const MAP_VENUE_LIST_LIMIT = 60;

export type MapVenueListModel = {
  /** Rows to render, nearest-first to the viewport centre when known. */
  rows: LogNearbyCandidate[];
  /** Total venues currently on the map (pre-cap). */
  total: number;
  /** Rows actually shown (post-cap). */
  shown: number;
  /** True when the cap hid some of the on-map venues. */
  truncated: boolean;
};

export type UkBasePubListRow = {
  id: string;
  name: string;
  priceLabel: "Unverified · no price";
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
 * Build the keyboard/AT-reachable list of the venues currently on the map.
 *
 * Ordered nearest-first to the viewport centre so the list mirrors what the eye
 * sees on the canvas; without a viewport fix it preserves the filtered map
 * order. Pure and deterministic — safe on empty input.
 */
export function buildMapVenueListModel(
  venues: Venue[],
  viewportCenter: [number, number] | null,
  limit: number = MAP_VENUE_LIST_LIMIT,
  lensPrices: ReadonlyMap<string, MapLensPrice> | null = null,
): MapVenueListModel {
  const total = venues.length;
  const origin =
    viewportCenter &&
    Number.isFinite(viewportCenter[0]) &&
    Number.isFinite(viewportCenter[1])
      ? { lng: viewportCenter[0], lat: viewportCenter[1] }
      : null;
  const baseRows = buildLogNearbyCandidates(venues, limit, origin);
  const rows =
    lensPrices === null
      ? baseRows
      : baseRows.map((row) => {
          const lensPrice = lensPrices.get(row.id);
          return {
            ...row,
            priceLabel: lensPrice
              ? `${lensPrice.categoryLabel} · £${lensPrice.priceGbp.toFixed(2)}`
              : "No price logged for this view",
          };
        });
  return { rows, total, shown: rows.length, truncated: total > rows.length };
}

export function buildUkBasePubListModel(
  pubs: UkBasePub[],
  viewportCenter: [number, number] | null,
  limit: number = MAP_VENUE_LIST_LIMIT,
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
    priceLabel: "Unverified · no price",
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
    total: pubs.length,
    shown: bounded.length,
    truncated: pubs.length > bounded.length,
  };
}
