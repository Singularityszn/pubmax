// Issue #35 — two-stage map load. The map paints pins from the ~400 KB slim
// index (lib/venuesSlim.ts) BEFORE the ~5.6 MB full price dataset lands, so the
// first interactive pin appears fast. This module is the pure bridge between the
// two: it turns a SlimVenue into a MINIMAL, Venue-SHAPE-COMPATIBLE object that
// PubMapCanvas's pubsToGeoJSON can render.
//
// pubsToGeoJSON (components/PubMapCanvas.tsx) reads exactly:
//   id, name, longitude, latitude, cheapestPrice, hasStory, prices (only via
//   priceForBeer when a favorite pint is chosen).
// Everything else on a full Venue (amenities, curation detail, contributor
// prices, filter/scoring inputs) is NOT touched to paint a pin — so the slim
// pin degrades those features until the full dataset hydrates, rather than
// blocking first paint:
//   • hasStory → false: no brass heritage ring until hydration.
//   • prices → []: with a favorite pint chosen, priceForBeer returns null, so a
//     slim pin reads as "doesn't serve it" (dimmed) until hydration re-prices it.
//   • all filter/scoring/saved-only inputs are absent → the slim phase MUST NOT
//     be run through filterVenues / buildCrawlRoute / savedOnly (PubMap gates
//     those on hydration; see PubMap.tsx).

import type { Venue } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";

/**
 * City slim packs embed the OSM address inside filterHints.searchText as
 *   "{name lower} {address lower} {borough lower}"
 * Recover it so drink/food price updates keyed by name|address|lat|lng attach
 * to city venues that have no VenuePrice rows.
 */
export function addressFromSlimSearchText(slim: SlimVenue): string {
  const search = (slim.filterHints?.searchText ?? "").trim().toLowerCase();
  if (!search) return "";
  const name = slim.name.trim().toLowerCase();
  const borough = slim.borough.trim().toLowerCase();
  let rest = search;
  const nameVariants = [name];
  if (name.startsWith("the ")) nameVariants.push(name.slice(4));
  for (const variant of nameVariants) {
    if (variant && rest.startsWith(variant)) {
      rest = rest.slice(variant.length).trim();
      break;
    }
  }
  if (borough && rest.endsWith(borough)) {
    rest = rest.slice(0, rest.length - borough.length).trim();
  }
  // If we couldn't strip the name (London fixtures often use a short searchText),
  // don't invent an address from the whole search blob.
  if (rest === search) return "";
  return rest;
}

// A slim pin is a real Venue value (so the canvas prop type is satisfied) built
// from the compact fields the pin paint and fast filters need; every other field carries a
// safe, inert default so nothing downstream throws before hydration.
export function slimVenueToPin(slim: SlimVenue): Venue {
  return {
    id: slim.id,
    name: slim.name,
    address: addressFromSlimSearchText(slim),
    latitude: slim.lat,
    longitude: slim.lng,
    primaryBorough: slim.borough,
    // Carry the nearest-station fare zone so the zone lens filters slim pins
    // before detail hydrates (undefined stays undefined — honestly unknown).
    ...(slim.zone !== undefined ? { zone: slim.zone } : {}),
    visibleBoroughs: slim.borough ? [slim.borough] : [],
    prices: [],
    cheapestPrice: slim.cheapestPrice,
    cheapestPint: "",
    averagePrice: null,
    // Prefer slim filterHints so heritage rings paint before full detail loads
    // (critical for non-London cities that have no detail artifact yet).
    hasStory: Boolean(slim.filterHints?.curation.hasStory),
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false,
      cocktails: false,
      beerGarden: false,
      liveSports: false,
      liveMusic: false,
      pubQuiz: false,
      darts: false,
      pool: false,
      happyHour: false,
      karaoke: false,
      nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...(slim.filterHints ? { filterHints: slim.filterHints } : {}),
    ...(slim.kind !== undefined ? { kind: slim.kind } : {}),
    ...(slim.priceBand !== undefined ? { priceBand: slim.priceBand } : {}),
  };
}

export function slimVenuesToPins(slim: SlimVenue[]): Venue[] {
  return slim.map(slimVenueToPin);
}
