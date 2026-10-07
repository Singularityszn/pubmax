import { formatGbp } from "@/lib/formatGbp";
import { haversineKm } from "@/lib/haversine";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import { mapVenueListCheapest, mapVenueListLensPrice } from "@/lib/mapVenueList";
import { compactVenueAnchor, type CompactVenueAnchor } from "@/lib/venueAnchorPresentation";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { Venue } from "@/lib/venues";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

// The phone map's resting answer: the cheapest listed price among the venues
// the reader can see, one line under the map. A pure leaf so the peek card, its
// tests and List view's first row all read the same ranking
// (lib/mapVenueList.ts, mapVenueListCheapest).

/** Past this the figure is a guess about a long trip, so the walk is left off. */
export const MAP_PEEK_MAX_WALK_MINUTES = 30;

type MapPeekAnswer = {
  venueId: string;
  name: string;
  priceGbp: number;
  /** The figure as List view's row prints it: "£X" for the pint default and
   *  for an anchor's own figure, and "<category> · £X" for any other lens
   *  figure, so a cocktail answer never reads as a pint. */
  priceLabel: string;
  /** The anchor the figure belongs to, as List view's row wears it, or null.
   *  The card renders it through the same CompactVenuePrice, so a set-lunch
   *  figure never reads as the pint answer. */
  anchor: CompactVenueAnchor | null;
  isPub: boolean;
  /** Whole walking minutes from the reader's own fix, or null without one. */
  walkMinutes: number | null;
};

/**
 * Loading: the map has not yet said what is in view, so no claim is made.
 * None: it has, and nothing in view carries a price. Both keep the card's
 * footprint, because a card that appears late moves every control above it.
 */
export type MapPeekModel =
  | { status: "loading" }
  | { status: "none" }
  | { status: "answer"; answer: MapPeekAnswer };

export function buildMapPeek(input: {
  /** The visible-venue projection has landed for this city. */
  ready: boolean;
  /** The kind-filtered venues inside the settled view. */
  venues: readonly Venue[];
  /** Active drink lens prices, or null for the pint default. */
  lensPrices?: ReadonlyMap<string, MapLensPrice> | null;
  venueSignals?: ReadonlyMap<string, { latestContributorPrice: number | null }> | null;
  /** The reader's own fix. A map centre is not where they stand. */
  reader?: { lat: number; lng: number } | null;
}): MapPeekModel {
  if (!input.ready) return { status: "loading" };
  const cheapest = mapVenueListCheapest(
    input.venues,
    input.lensPrices ?? null,
    input.venueSignals ?? null,
  );
  if (!cheapest) return { status: "none" };
  const { venue, priceGbp } = cheapest;
  const lensPrice = input.lensPrices?.get(venue.id) ?? null;
  const anchor = compactVenueAnchor(venue);
  const price = lensPrice
    ? mapVenueListLensPrice(lensPrice, anchor)
    : { priceLabel: formatGbp(priceGbp), anchor };
  let walkMinutes: number | null = null;
  const reader = input.reader;
  if (reader && Number.isFinite(reader.lat) && Number.isFinite(reader.lng)) {
    const minutes = walkMinutesFromKm(
      haversineKm([reader.lng, reader.lat], [venue.longitude, venue.latitude]),
    );
    if (minutes <= MAP_PEEK_MAX_WALK_MINUTES) walkMinutes = minutes;
  }
  return {
    status: "answer",
    answer: {
      venueId: venue.id,
      name: venue.name,
      priceGbp,
      ...price,
      isPub: isPubVenueKind(venue.kind),
      walkMinutes,
    },
  };
}

/** The card's one spoken line, shared by its accessible name and the tests. */
export function mapPeekSummary(model: MapPeekModel): string {
  if (model.status === "loading") return "Looking for the cheapest price in view";
  if (model.status === "none") return "No listed price in this view";
  const { answer } = model;
  const walk =
    answer.walkMinutes === null ? "" : `, ${answer.walkMinutes} minute walk`;
  const price = answer.anchor
    ? `${answer.anchor.label} · ${answer.priceLabel} (${answer.anchor.observedLabel} · ${answer.anchor.sourceLabel})`
    : answer.priceLabel;
  return `Cheapest in this view: ${price} at ${answer.name}${walk}`;
}
