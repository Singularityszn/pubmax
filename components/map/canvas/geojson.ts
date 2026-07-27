import { priceForBeer } from "@/lib/beers";
import { POI_CATEGORY_META, type Poi } from "@/lib/pois";
import { drinkPinKindFromCategories, iconId, venuePinIconKey } from "@/lib/mapIcons";
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

/**
 * The pin's price tag text, or null when this pub has no figure it is allowed
 * to say out loud.
 *
 * Short on purpose: a pin glyph is ~28px wide, so the label has to read in one
 * saccade next to a dozen neighbours. Whole pounds drop the pence ("£6", not
 * "£6.00") because two dead zeroes cost a third of the glyph's width and carry
 * no information; anything else keeps both decimals ("£5.40") so the column of
 * prices down a street stays comparable at a glance.
 *
 * Null for anything that is not a real, positive figure - a missing price is
 * NEVER a placeholder on this map ("£?" is a worse answer than silence).
 */
export function formatPinPriceLabel(price: number | null | undefined): string | null {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  const pence = Math.round(price * 100);
  if (pence <= 0) return null;
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
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
  // Venues with an in-window pint report that has NOT earned the map yet
  // (components/map/communityPriceSignals.ts). Deliberately its own argument
  // rather than a VenueSignal field: it must be impossible for this to reach
  // the price stack above, which is what `bucket` and every downstream price
  // surface read. It paints one badge layer and nothing else.
  provisionalVenueIds: ReadonlySet<string> | null = null,
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
      const bucket = venue.priceBand ?? priceBucket(price);
      // The price the pin is allowed to SAY, as opposed to the band it is
      // allowed to PAINT. Same stack as `price` above, minus the demo seed:
      // a seeded figure may tint a pin (a colour band is a hint, and the seed
      // exists so a city pack with null cheapestPrice still reads as a map) but
      // printing "£5.40" over a pub is a claim about that pub, and we have no
      // observation behind it. So the seed lane stops here, deliberately.
      //
      // A PROVISIONAL report cannot reach this line at all: an uncorroborated
      // submission never becomes `latestContributorPrice` (the gate is
      // mergeCommunityPriceSignals), so the rule the `provisional` prop below
      // states - a mark, never a figure - holds for the label too, with no
      // second gate to keep in sync. Where such a pub ALSO carries a curated
      // sourced price, that curated figure still shows: it is the same price
      // `bucket` is already painting, and hiding it because someone filed an
      // unconfirmed report would be the map lying about what it knows.
      const sourcedPrice = favoritePint
        ? beerPrice
        : signals?.latestContributorPrice ?? venue.cheapestPrice ?? null;
      const priceLabel = formatPinPriceLabel(sourcedPrice);
      // Active drink lens owns the glyph: beer → pint glasses, wine → wine, etc.
      // Without a lens, fall back to venue hint categories.
      const lens = drinkCategory?.trim().toLowerCase() ?? "";
      // Only REAL recorded drink categories drive the resting (lens-off) pin
      // glyph. When a venue has none (filterHints.drinkCategories absent/empty),
      // the honest default for a pub is a pint glass — never the synthetic
      // per-venue accent hash (drinkAccentForVenue stays decorative card art),
      // which otherwise painted ale-led heritage pubs like The Black Friar with
      // a hash-random martini glyph (owner audit). #372 fixed the amenity path;
      // this closes the accent path. The cocktails amenity alone likewise never
      // promotes a hintless pub to a martini pin — a pub that pours cocktails is
      // still a pub. An explicit cocktail lens (below) is a user choice and does
      // paint martinis, as intended.
      const hintCategories = venue.filterHints?.drinkCategories;
      const drinkKind =
        venue.kind === "bar"
          ? "coupe"
          : venue.kind === "food"
            ? "skewer"
            : lens === "beer"
          ? "pint"
          : lens && lens !== "other"
            ? drinkPinKindFromCategories(
                [lens],
                lens === "cocktail" ||
                  Boolean(venue.amenities.cocktails) ||
                  Boolean(venue.filterHints?.amenities.cocktails),
              )
            : hintCategories && hintCategories.length > 0
              ? drinkPinKindFromCategories(
                  hintCategories,
                  Boolean(venue.amenities.cocktails) ||
                    Boolean(venue.filterHints?.amenities.cocktails),
                )
              : "pint";
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
          kind: venue.kind ?? "pub",
          bucket,
          story: venue.hasStory,
          drops: Boolean(signals?.hasPintDrops),
          // Someone logged a pint price here and it is still one report short
          // of moving the map. A mark, never a figure — the pin's colour is
          // still `bucket`, derived from the price stack above.
          provisional: Boolean(provisionalVenueIds?.has(venue.id)),
          serves,
          drinkKind,
          scraped,
          icon: iconId("drink", venuePinIconKey(drinkKind, bucket)),
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
          // Render-ready price tag for the pin's text-field. ABSENT (not null,
          // not "") on an unpriced pub so ["has","priceLabel"] and a coalesce
          // to "" both read cleanly, exactly like `whatsOn` above - the ~38k
          // UK base pubs are a different source entirely and never come near
          // this function.
          ...(priceLabel ? { priceLabel } : {}),
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

// The instant straight-line paint: joins the stops with straight segments. It
// carries `source: "straight"` so the map draws it as the dashed "approximate"
// route (buildScene.buildRoute) until /api/walk-route upgrades routeLineRef to a
// road-following LineString (source "ors", drawn solid). See PubMapCanvas.
export function routeToLine(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      route.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: { source: "straight" },
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
    features: catalog.map((landmark, index) => ({
      type: "Feature",
      properties: {
        id: landmark.id,
        name: landmark.name,
        icon: iconId("lm", landmark.icon),
        // Collision priority for the symbol layer's `symbol-sort-key`: the
        // catalog is a curated list, so its order IS the ranking, and shipping
        // it as a feature property keeps that ranking stable across tiles
        // (MapLibre's default ordering is not).
        priority: index,
      },
      geometry: { type: "Point", coordinates: landmark.coordinates },
    })),
  };
}
