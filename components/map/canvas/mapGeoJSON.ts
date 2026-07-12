// Pure GeoJSON builders for the PubMap canvas: venue pins, POIs, crawl route
// line + numbered stops, story-band corridors, landmark markers. Each is a pure
// (data) → FeatureCollection function, extracted verbatim from PubMapCanvas.

import {
  bandAnchors,
  type StoryBand,
} from "@/lib/storyBands";
import { type Landmark } from "@/lib/landmarks";
import { priceForBeer } from "@/lib/beers";
import { POI_CATEGORY_META, type Poi } from "@/lib/pois";
import {
  drinkPinIconKey,
  drinkPinKindFromCategories,
  iconId,
} from "@/lib/mapIcons";
import { drinkAccentForVenue } from "@/lib/scrapedPubs";
import { type Venue } from "@/lib/venues";

export type VenueSignal = {
  hasPintDrops: boolean;
  latestContributorPrice: number | null;
  /** Display-only demo price for pin colour when cheapestPrice is null. */
  latestDemoPrice?: number | null;
};

export function priceBucket(price: number | null): number {
  if (price === null) return 3;
  if (price <= 5.5) return 0;
  if (price <= 7) return 1;
  return 2;
}

export function pubsToGeoJSON(
  venues: Venue[],
  venueSignals: Map<string, VenueSignal>,
  favoritePint: string | null,
  drinkCategory: string | null = null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const signals = venueSignals.get(venue.id);
      // Beer favorite-pint path only: re-price + dim non-servers. Non-beer
      // drink/brand lenses filter via filterVenues — never invent brand prices.
      const beerPrice = favoritePint ? priceForBeer(venue, favoritePint) : null;
      const serves = !favoritePint || beerPrice !== null;
      // Contributor price wins; then slim-index cheapestPrice; then an honest
      // demo seed price so city packs with null cheapestPrice still colour pins.
      // Demo never merges into venue.cheapestPrice (mergeVenueDrops ignores it).
      const price = favoritePint
        ? beerPrice
        : signals?.latestContributorPrice ??
          venue.cheapestPrice ??
          signals?.latestDemoPrice ??
          null;
      const bucket = priceBucket(price);
      // Active drink lens owns the glyph: beer → pint glasses, wine → wine, etc.
      // Without a lens, fall back to venue hint categories.
      const lens = drinkCategory?.trim().toLowerCase() ?? "";
      const hintCategories = venue.filterHints?.drinkCategories;
      const accentCategories =
        hintCategories && hintCategories.length > 0
          ? hintCategories
          : [drinkAccentForVenue(venue.id)];
      const drinkKind =
        lens === "beer"
          ? "pint"
          : lens && lens !== "other"
            ? drinkPinKindFromCategories(
                [lens],
                lens === "cocktail" ||
                  Boolean(venue.amenities.cocktails) ||
                  Boolean(venue.filterHints?.amenities.cocktails),
              )
            : drinkPinKindFromCategories(
                accentCategories,
                Boolean(venue.amenities.cocktails) ||
                  Boolean(venue.filterHints?.amenities.cocktails),
              );
      const scraped = Boolean(
        venue.filterHints?.scraped ||
          venue.sourceDatasets?.some((source) =>
            /london_chain|greene.?king|nicholson|youngs/i.test(source),
          ),
      );
      return {
        type: "Feature" as const,
        properties: {
          id: venue.id,
          name: venue.name,
          bucket,
          story: venue.hasStory,
          drops: Boolean(signals?.hasPintDrops),
          serves,
          drinkKind,
          scraped,
          icon: iconId("drink", drinkPinIconKey(drinkKind, bucket)),
        },
        geometry: { type: "Point" as const, coordinates: [venue.longitude, venue.latitude] },
      };
    }),
  };
}

// POIs → GeoJSON, one feature per point. category drives which layer/symbol it
// renders on; rank (1 = major interchange, 2 = minor) drives the zoom-depth
// reveal so the network reads wide and detail fills in as you zoom.
export function poisToGeoJSON(pois: Poi[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((poi) => ({
      type: "Feature" as const,
      properties: {
        id: poi.id,
        name: poi.name,
        category: poi.category,
        rank: poi.rank ?? 2,
        // Ambient dot colour baked per-feature from the category palette so the
        // dot layer stays data-driven as new categories are added.
        color: POI_CATEGORY_META[poi.category].color,
      },
      geometry: { type: "Point" as const, coordinates: poi.coordinates },
    })),
  };
}

export function routeToLine(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      route.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: route.map((venue) => [venue.longitude, venue.latitude]),
              },
            },
          ]
        : [],
  };
}

export function routeToStops(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: route.map((venue, index) => ({
      type: "Feature" as const,
      properties: { id: venue.id, label: String(index + 1) },
      geometry: { type: "Point" as const, coordinates: [venue.longitude, venue.latitude] },
    })),
  };
}

// Issue #15 story bands — the tinted corridor through a band's anchor landmarks.
// A simple polyline joining the anchors in order: the map draws it as a soft,
// low-opacity token-tinted stroke UNDER the pins so it hints at the walk without
// fighting the price-colour fill. Empty when the band resolves to <2 anchors.
export function bandCorridorGeoJSON(
  band: StoryBand | undefined,
  catalog: readonly Landmark[],
): GeoJSON.FeatureCollection {
  if (!band) return { type: "FeatureCollection", features: [] };
  const anchors = bandAnchors(band, catalog);
  if (anchors.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: anchors.map((lm) => lm.coordinates),
        },
      },
    ],
  };
}

export function landmarksToGeoJSON(catalog: readonly Landmark[]): GeoJSON.FeatureCollection {
  // Each landmark carries its own pictogram id (lib/mapIcons, ns "lm") so the
  // symbol layer draws a recognisable silhouette per feature.
  return {
    type: "FeatureCollection",
    features: catalog.map((landmark) => ({
      type: "Feature",
      properties: {
        id: landmark.id,
        name: landmark.name,
        icon: iconId("lm", landmark.icon),
      },
      geometry: { type: "Point", coordinates: landmark.coordinates },
    })),
  };
}
