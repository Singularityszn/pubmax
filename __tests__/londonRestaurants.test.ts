// The London restaurant layer (lib/londonRestaurants.ts): the pack decoder,
// the read, the curated-twin rule, when the layer shows, when the pack is
// read, and the tap that opens a restaurant's sheet.

import { describe, expect, it, vi } from "vitest";

import { PIN_MIN_ZOOM } from "@/components/map/canvas/buildScene";
import { PUB_FIRST_LAYERS, wireClickRouting } from "@/components/map/canvas/interactions";
import {
  LONDON_RESTAURANT_MIN_ZOOM,
  LONDON_RESTAURANT_PACK_PATH,
  londonRestaurantLayerShown,
  londonRestaurantPackWanted,
  londonRestaurantsPassingMapFilters,
  londonRestaurantsToGeoJSON,
  londonRestaurantsWithoutCuratedTwin,
  loadLondonRestaurants,
  parseLondonRestaurantPack,
  type LondonRestaurant,
} from "@/lib/londonRestaurants";
import { londonVenueIdFromFeature } from "@/lib/londonVenueShards";
import { slimVenueToPin } from "@/lib/slimPins";
import { initialFilters, type Filters } from "@/lib/venues";

const RULES_ROW = [
  "n101",
  "Rules",
  "35 Maiden Lane, London",
  51.51083,
  -0.12319,
  "restaurant",
  "Westminster",
];
const FURNIVAL_ROW = [
  "n25496840",
  "26 Furnival Street",
  "26, Furnival Street, London, EC4A 1JS",
  51.51671,
  -0.11036,
  "restaurant",
  "City of London",
];

function pack(rows: unknown[][], overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    kind: "restaurant",
    layer: "/data/london_venues/packs/0123456789abcdef/",
    count: rows.length,
    venues: rows,
    ...overrides,
  };
}

function restaurant(overrides: Partial<LondonRestaurant> = {}): LondonRestaurant {
  return {
    id: "venue-osm-n1",
    name: "Dishoom",
    address: "",
    lat: 51.5124,
    lng: -0.1269,
    kind: "restaurant",
    borough: "Westminster",
    ...overrides,
  };
}

describe("parseLondonRestaurantPack", () => {
  it("decodes every row into a venue-osm restaurant", () => {
    expect(parseLondonRestaurantPack(pack([FURNIVAL_ROW]))).toEqual([
      {
        id: "venue-osm-n25496840",
        name: "26 Furnival Street",
        address: "26, Furnival Street, London, EC4A 1JS",
        lat: 51.51671,
        lng: -0.11036,
        kind: "restaurant",
        borough: "City of London",
      },
    ]);
  });

  it("refuses a row that names no borough, as a pack cut before boroughs would", () => {
    expect(parseLondonRestaurantPack(pack([FURNIVAL_ROW.slice(0, 6)]))).toBeNull();
    expect(parseLondonRestaurantPack(pack([[...FURNIVAL_ROW.slice(0, 6), null]]))).toBeNull();
  });

  it("refuses a pack that lost a row, rather than hiding a restaurant", () => {
    expect(
      parseLondonRestaurantPack(pack([FURNIVAL_ROW, ["n2", "", "", 51.5, -0.1, "restaurant", ""]])),
    ).toBeNull();
    expect(parseLondonRestaurantPack(pack([FURNIVAL_ROW], { count: 2 }))).toBeNull();
  });

  it("refuses a row of any other kind and a pack of another version", () => {
    expect(
      parseLondonRestaurantPack(pack([["n3", "Desk & Bean", "", 51.5, -0.1, "cafe", ""]])),
    ).toBeNull();
    expect(parseLondonRestaurantPack(pack([FURNIVAL_ROW], { version: 1 }))).toBeNull();
    expect(parseLondonRestaurantPack(pack([FURNIVAL_ROW], { kind: "cafe" }))).toBeNull();
    expect(parseLondonRestaurantPack(null)).toBeNull();
  });
});

describe("loadLondonRestaurants", () => {
  it("reads the one pack and nothing else", async () => {
    const fetchImpl = vi.fn(async () => Response.json(pack([RULES_ROW, FURNIVAL_ROW])));
    const loaded = await loadLondonRestaurants(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(LONDON_RESTAURANT_PACK_PATH);
    expect(loaded.map((venue) => venue.name)).toEqual(["Rules", "26 Furnival Street"]);
  });

  it("rejects a failed or malformed read rather than drawing no restaurants", async () => {
    const missing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(loadLondonRestaurants(missing as unknown as typeof fetch)).rejects.toThrow(
      /404/,
    );
    const malformed = vi.fn(async () => Response.json({ venues: [] }));
    await expect(loadLondonRestaurants(malformed as unknown as typeof fetch)).rejects.toThrow(
      /malformed/,
    );
  });
});

describe("londonRestaurantsWithoutCuratedTwin", () => {
  const curated = (name: string, latitude: number, longitude: number) => ({
    name,
    latitude,
    longitude,
  });

  it("drops the OSM row a curated venue already pins, by name and place", () => {
    const dishoom = restaurant({ name: "Dishoom" });
    const kept = londonRestaurantsWithoutCuratedTwin(
      [dishoom, restaurant({ id: "venue-osm-n2", name: "Barrafina", lat: 51.5126, lng: -0.1271 })],
      [curated("Dishoom Covent Garden", 51.51243, -0.12695)],
    );
    expect(kept.map((venue) => venue.name)).toEqual(["Barrafina"]);
  });

  it("reads '&' as 'and' and ignores a leading 'the'", () => {
    const kept = londonRestaurantsWithoutCuratedTwin(
      [
        restaurant({ name: "Duck & Waffle" }),
        restaurant({ id: "venue-osm-n2", name: "The Wolseley", lat: 51.5073, lng: -0.1411 }),
      ],
      [
        curated("Duck and Waffle", 51.5124, -0.1269),
        curated("Wolseley", 51.5073, -0.1411),
      ],
    );
    expect(kept).toEqual([]);
  });

  it("keeps a restaurant that only shares a name with a far curated venue", () => {
    const anchor = restaurant({ name: "The Anchor", lat: 51.3, lng: -0.27 });
    expect(
      londonRestaurantsWithoutCuratedTwin([anchor], [curated("The Anchor", 51.5076, -0.0948)]),
    ).toEqual([anchor]);
  });

  it("keeps a restaurant beside a curated venue with another name", () => {
    const neighbour = restaurant({ name: "Barrafina" });
    expect(
      londonRestaurantsWithoutCuratedTwin([neighbour], [curated("Lamb & Flag", 51.5124, -0.1269)]),
    ).toEqual([neighbour]);
  });

  it("finds a twin across a grid cell edge", () => {
    // 0.002 degrees of latitude is the twin grid's cell; these two sit either
    // side of a cell line, about 33 m apart.
    const edge = restaurant({ name: "Quo Vadis", lat: 51.51399, lng: -0.1327 });
    expect(
      londonRestaurantsWithoutCuratedTwin([edge], [curated("Quo Vadis", 51.51429, -0.1327)]),
    ).toEqual([]);
  });
});

describe("londonRestaurantLayerShown", () => {
  const base = {
    isLondon: true,
    restaurantKindVisible: true,
    experienceLens: "all" as const,
    lensOwnsMap: false,
  };

  it("shows on the London pint map with restaurants on in the filter", () => {
    expect(londonRestaurantLayerShown(base)).toBe(true);
  });

  it("hides outside London and when the kind filter hides restaurants", () => {
    expect(londonRestaurantLayerShown({ ...base, isLondon: false })).toBe(false);
    expect(londonRestaurantLayerShown({ ...base, restaurantKindVisible: false })).toBe(false);
  });

  it("gives the map to a drink lane or the no-alcohol view, but shows under food", () => {
    expect(londonRestaurantLayerShown({ ...base, lensOwnsMap: true })).toBe(false);
    expect(
      londonRestaurantLayerShown({ ...base, experienceLens: "no-alcohol", lensOwnsMap: true }),
    ).toBe(false);
    expect(
      londonRestaurantLayerShown({ ...base, experienceLens: "food", lensOwnsMap: true }),
    ).toBe(true);
  });
});

describe("londonRestaurantsPassingMapFilters", () => {
  const dishoom = restaurant({ id: "venue-osm-n1", name: "Dishoom", address: "12 Upper St Martin's Lane" });
  const rules = restaurant({
    id: "venue-osm-n2",
    name: "Rules",
    address: "35 Maiden Lane",
    lat: 51.51083,
    lng: -0.12319,
  });
  const both = [dishoom, rules];
  const base: {
    filters: Filters;
    savedOnly: boolean;
    nearMe: { location: { lat: number; lng: number }; radiusKm: number } | null;
    selectedVenueId: string;
    curated: Parameters<typeof londonRestaurantsPassingMapFilters>[1]["curated"];
  } = {
    filters: initialFilters,
    savedOnly: false,
    nearMe: null,
    selectedVenueId: "",
    curated: [],
  };
  const pass = (overrides: Partial<typeof base>, filters: Partial<Filters> = {}) =>
    londonRestaurantsPassingMapFilters(both, {
      ...base,
      ...overrides,
      filters: { ...initialFilters, ...filters },
    }).map((place) => place.id);

  it("lets every restaurant through while no filter narrows the map", () => {
    expect(pass({})).toEqual([dishoom.id, rules.id]);
  });

  it("matches the search against a name, an address or a borough", () => {
    expect(pass({}, { query: "  DISHOOM " })).toEqual([dishoom.id]);
    expect(pass({}, { query: "maiden" })).toEqual([rules.id]);
    expect(pass({}, { query: "wolseley" })).toEqual([]);
    expect(pass({}, { query: "westminster" })).toEqual([dishoom.id, rules.id]);
    const kingsCross = restaurant({ id: "venue-osm-n3", name: "Dishoom", borough: "Camden" });
    expect(
      londonRestaurantsPassingMapFilters([...both, kingsCross], {
        ...base,
        filters: { ...initialFilters, query: "camden" },
      }).map((place) => place.id),
    ).toEqual([kingsCross.id]);
  });

  describe("an area the pack names nowhere", () => {
    const pin = (address: string, latitude: number, longitude: number, borough = "Westminster") => ({
      latitude,
      longitude,
      address,
      primaryBorough: borough,
      visibleBoroughs: [borough],
    });
    const searched = (
      restaurants: LondonRestaurant[],
      curated: typeof base.curated,
      query: string,
    ) =>
      londonRestaurantsPassingMapFilters(restaurants, {
        ...base,
        curated,
        filters: { ...initialFilters, query },
      }).map((place) => place.id);

    it("keeps the Soho restaurants near a curated pin whose address says Soho", () => {
      const threeGreyhounds = pin("Old Compton Street, Soho, W1D 4DZ, London", 51.51344, -0.13031);
      const bocca = restaurant({ id: "venue-osm-soho", name: "Bocca Di Lupo", lat: 51.5116, lng: -0.1338 });
      const mayfair = restaurant({ id: "venue-osm-far", name: "Scott's", lat: 51.5098, lng: -0.1508 });
      expect(searched([bocca, mayfair], [threeGreyhounds], "soho")).toEqual([bocca.id]);
    });

    it("keeps the Shoreditch and Clapham restaurants the same way", () => {
      const queensHead = pin("222 Shoreditch High St, London E1 6PJ", 51.5227, -0.0780131, "Hackney");
      const belleVue = pin("1 Clapham Common South Side, London SW4 7AA", 51.4618, -0.137634, "Lambeth");
      const dishoomShoreditch = restaurant({
        id: "venue-osm-shoreditch",
        name: "Dishoom",
        lat: 51.5245,
        lng: -0.0767,
        borough: "Hackney",
      });
      const claphamGrill = restaurant({
        id: "venue-osm-clapham",
        name: "Grill on the Common",
        lat: 51.4625,
        lng: -0.1395,
        borough: "Lambeth",
      });
      const places = [dishoomShoreditch, claphamGrill];
      expect(searched(places, [queensHead, belleVue], "shoreditch")).toEqual([dishoomShoreditch.id]);
      expect(searched(places, [queensHead, belleVue], "clapham")).toEqual([claphamGrill.id]);
    });

    it("takes no area from a curated pin's name", () => {
      const sohoHouse = { ...pin("76 Dean Street, London W1D 3SQ", 51.5136, -0.1323), name: "Soho House" };
      const bocca = restaurant({ id: "venue-osm-soho", name: "Bocca Di Lupo", lat: 51.5116, lng: -0.1338 });
      expect(searched([bocca], [sohoHouse], "soho")).toEqual([]);
    });

    it("takes no area from the drinks a slim pin pours", () => {
      const blueBoar = slimVenueToPin({
        id: "venue-blue-boar",
        name: "Blue Boar Pub",
        lat: 51.5116,
        lng: -0.1335,
        cheapestPrice: 6,
        borough: "Westminster",
        filterHints: {
          searchText: "blue boar pub 45 tothill st, london sw1h 9lq westminster soho lager",
          amenities: {
            food: false,
            cocktails: false,
            beerGarden: false,
            liveSports: false,
            nonAlcoholic: false,
          },
          curation: { nearWater: false, hasStory: false },
          canonical: true,
          drinkText: "soho lager",
        },
      });
      const bocca = restaurant({ id: "venue-osm-soho", name: "Bocca Di Lupo", lat: 51.5116, lng: -0.1338 });
      expect(searched([bocca], [blueBoar], "soho")).toEqual([]);
      expect(searched([bocca], [blueBoar], "tothill")).toEqual([bocca.id]);
    });

    it("keeps no area restaurant while a filter hides every restaurant", () => {
      const threeGreyhounds = pin("Old Compton Street, Soho, W1D 4DZ, London", 51.51344, -0.13031);
      const bocca = restaurant({ id: "venue-osm-soho", name: "Bocca Di Lupo", lat: 51.5116, lng: -0.1338 });
      expect(
        londonRestaurantsPassingMapFilters([bocca], {
          ...base,
          savedOnly: true,
          curated: [threeGreyhounds],
          filters: { ...initialFilters, query: "soho" },
        }),
      ).toEqual([]);
    });
  });

  it("lets the food filter through, because a restaurant serves food", () => {
    expect(pass({}, { requireFood: true })).toEqual([dishoom.id, rules.id]);
  });

  it("hides every restaurant while Saved only is on, because no restaurant can be saved", () => {
    expect(pass({ savedOnly: true })).toEqual([]);
  });

  it("keeps the restaurants inside the near-me walk ring", () => {
    const nearDishoom = { location: { lat: dishoom.lat, lng: dishoom.lng + 0.001 }, radiusKm: 0.2 };
    const farFromBoth = { location: { lat: dishoom.lat + 0.05, lng: dishoom.lng }, radiusKm: 1 };
    const besideBoth = { location: { lat: 51.5116, lng: -0.125 }, radiusKm: 1 };
    expect(pass({ nearMe: besideBoth })).toEqual([dishoom.id, rules.id]);
    expect(pass({ nearMe: nearDishoom })).toEqual([dishoom.id]);
    expect(pass({ nearMe: farFromBoth })).toEqual([]);
    expect(pass({ nearMe: nearDishoom }, { query: "rules" })).toEqual([]);
  });

  it("hides every restaurant while a filter asks what a row cannot answer", () => {
    const unanswerable: Partial<Filters>[] = [
      { maxPrice: 6 },
      { openNow: true },
      { zone: "1" },
      { canonicalOnly: true },
      { requirePintDrops: true },
      { requireBeerGarden: true },
      { requireNonAlcoholic: true },
      { requireLiveSports: true },
      { requireCocktails: true },
      { requireWater: true },
      { requireHeritage: true },
      { requireStepFree: true },
      { requireAccessibleToilet: true },
      { requireSeatedService: true },
      { drinkCategory: "gin" },
      { drinkBrand: "guinness" },
      { topShelfOnly: true },
    ];
    for (const filters of unanswerable) expect(pass({}, filters)).toEqual([]);
  });

  it("reads an uncapped price and every zone as no narrowing", () => {
    expect(pass({}, { maxPrice: Number.POSITIVE_INFINITY, zone: "all" })).toEqual([
      dishoom.id,
      rules.id,
    ]);
  });

  it("keeps the selected restaurant, as a selected curated pin is kept", () => {
    expect(pass({ savedOnly: true, selectedVenueId: rules.id })).toEqual([rules.id]);
    expect(pass({ selectedVenueId: rules.id }, { query: "dishoom" })).toEqual([
      dishoom.id,
      rules.id,
    ]);
  });
});

describe("londonRestaurantPackWanted", () => {
  const base = { shown: true, held: false, zoom: 12, selectedVenueId: "", selectedIsCafe: false };

  it("draws from the pin floor every other unclustered pin layer uses", () => {
    expect(LONDON_RESTAURANT_MIN_ZOOM).toBe(PIN_MIN_ZOOM);
  });

  it("reads the pack once the camera reaches the zoom the layer draws from", () => {
    expect(londonRestaurantPackWanted(base)).toBe(true);
    expect(londonRestaurantPackWanted({ ...base, zoom: 11.9 })).toBe(false);
  });

  it("waits for the priced pins, and asks for nothing while the layer is hidden", () => {
    expect(londonRestaurantPackWanted({ ...base, held: true })).toBe(false);
    expect(londonRestaurantPackWanted({ ...base, shown: false })).toBe(false);
  });

  it("reads the pack for a selected restaurant wherever the camera is", () => {
    expect(
      londonRestaurantPackWanted({ ...base, zoom: 9, selectedVenueId: "venue-osm-n25496840" }),
    ).toBe(true);
    expect(londonRestaurantPackWanted({ ...base, zoom: 9, selectedVenueId: "venue-1" })).toBe(
      false,
    );
  });

  it("reads nothing for a selected pilot cafe the camera is too far out to draw beside", () => {
    expect(
      londonRestaurantPackWanted({
        ...base,
        zoom: 9,
        selectedVenueId: "venue-osm-w271641406",
        selectedIsCafe: true,
      }),
    ).toBe(false);
  });
});

describe("the restaurant source and its tap", () => {
  it("carries the id and name and no price", () => {
    const collection = londonRestaurantsToGeoJSON([restaurant()]);
    expect(collection.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-0.1269, 51.5124] },
        properties: { id: "venue-osm-n1", name: "Dishoom" },
      },
    ]);
  });

  it("reads only a venue-osm id back from a tapped feature", () => {
    expect(londonVenueIdFromFeature({ properties: { id: "venue-osm-n1" } })).toBe(
      "venue-osm-n1",
    );
    expect(londonVenueIdFromFeature({ properties: { id: "venue-uk-n1" } })).toBeNull();
    expect(londonVenueIdFromFeature({ properties: {} })).toBeNull();
  });

  it("answers a tap after every pub layer and before the landmarks", () => {
    const order = [...PUB_FIRST_LAYERS] as string[];
    expect(order.indexOf("london-restaurant-point")).toBeGreaterThan(order.indexOf("pubs-point"));
    expect(order.indexOf("london-restaurant-point")).toBeGreaterThan(
      order.indexOf("uk-base-point"),
    );
    expect(order.indexOf("london-restaurant-point")).toBeLessThan(
      order.indexOf("landmarks-icon"),
    );
  });

  it("opens the restaurant through the venue drawer, by its own id", () => {
    let clickHandler: ((event: { point: { x: number; y: number } }) => void) | undefined;
    const map = {
      on: vi.fn((event: string, handler: typeof clickHandler) => {
        if (event === "click") clickHandler = handler;
      }),
      getLayer: vi.fn(() => ({})),
      queryRenderedFeatures: vi.fn(() => [
        { layer: { id: "london-restaurant-point" }, properties: { id: "venue-osm-n25496840" } },
        { layer: { id: "landmarks-icon" }, properties: { id: "st-pauls" } },
      ]),
      getZoom: vi.fn(() => 15),
    };
    const onVenueClick = vi.fn();
    const selectLandmark = vi.fn();
    wireClickRouting(map as never, {
      selectLandmark,
      setHoveredVenue: vi.fn(),
      setActivePoi: vi.fn(),
      onVenueClickRef: { current: onVenueClick },
      onUkBasePubClickRef: { current: vi.fn() },
      onRouteStopClickRef: { current: vi.fn() },
      onTonightOpportunityClickRef: { current: vi.fn() },
      cityLandmarksRef: { current: [] },
      tonightOpportunitiesRef: { current: [] },
      cinematic: vi.fn(),
    });

    clickHandler?.({ point: { x: 10, y: 10 } });

    expect(onVenueClick).toHaveBeenCalledWith("venue-osm-n25496840");
    expect(selectLandmark).toHaveBeenCalledWith(null);
  });
});
