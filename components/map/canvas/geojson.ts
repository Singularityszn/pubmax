import { priceForBeer } from "@/lib/beers";
import { POI_CATEGORY_META, type Poi } from "@/lib/pois";
import { drinkPinIconKey, drinkPinKindFromCategories, iconId } from "@/lib/mapIcons";
import { drinkAccentForVenue } from "@/lib/scrapedPubs";
import type { Landmark } from "@/lib/landmarks";
import { bandAnchors, type StoryBand } from "@/lib/storyBands";
import type { Venue } from "@/lib/venues";
import type { VenueWhatsOnSummary } from "@/lib/whatsOnBadges";
import type { VenueSignal } from "./types";
import { hashEntranceSeed } from "./filters";
import { PIN_ENTRANCE_BUCKETS } from "./tokens";

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
  // W1: venueId-joined What's-On summary per venue (quiz/sport/deal/music
  // tonight). Feeds pin BADGES through the existing pin pipeline — a hero-kind
  // glyph property the badge layer paints. Absent map = no badges (default).
  whatsOnByVenue: Map<string, VenueWhatsOnSummary> | null = null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const signals = venueSignals.get(venue.id);
      const whatsOn = whatsOnByVenue?.get(venue.id) ?? null;
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
          // M7 pin entrance — a stable per-pub stagger bucket (hash of id, not
          // insertion order/coordinates) so the entrance cascade reads as a
          // pleasant scatter rather than left-to-right or dataset-order.
          entranceSeed: hashEntranceSeed(venue.id, PIN_ENTRANCE_BUCKETS),
          // W1 badge props. `whatsOn` is the hero kind slug (absent when the
          // venue has nothing on tonight, so ["has","whatsOn"] filters cleanly);
          // `whatsOnTimed` gates the "timed hero vs untimed attribute" styling.
          ...(whatsOn
            ? { whatsOn: whatsOn.heroKind, whatsOnTimed: whatsOn.timed }
            : {}),
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

// Route-stop plaque labels: the pub name that rides beside each numbered stop.
// A long name ("The Old Bank of England") is truncated so it never sprawls
// across the route; the ellipsis signals there's more. Trim first so trailing
// spaces don't eat the budget, and drop a trailing space before the ellipsis so
// we never emit "word …".
export const ROUTE_STOP_LABEL_MAX = 18;

export function truncateStopName(name: string, max = ROUTE_STOP_LABEL_MAX): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  // Reserve one slot for the single-glyph ellipsis.
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function routeToStops(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: route.map((venue, index) => ({
      type: "Feature" as const,
      properties: {
        id: venue.id,
        label: String(index + 1),
        // Full name kept for downstream reads; `stopName` is the truncated
        // plaque text the map draws beside the numbered disc.
        name: venue.name,
        stopName: truncateStopName(venue.name),
      },
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
