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

// A slim pin is a real Venue value (so the canvas prop type is satisfied) built
// from the compact fields the pin paint and fast filters need; every other field carries a
// safe, inert default so nothing downstream throws before hydration.
export function slimVenueToPin(slim: SlimVenue): Venue {
  return {
    id: slim.id,
    name: slim.name,
    address: "",
    latitude: slim.lat,
    longitude: slim.lng,
    primaryBorough: slim.borough,
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
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...(slim.filterHints ? { filterHints: slim.filterHints } : {}),
  };
}

export function slimVenuesToPins(slim: SlimVenue[]): Venue[] {
  return slim.map(slimVenueToPin);
}
