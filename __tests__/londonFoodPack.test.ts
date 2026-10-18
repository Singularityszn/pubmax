// The London food pack and the rules that ride on it (lib/londonFoodPlaces.ts).
// The committed pack is a projection of the committed shards, read here from the
// shipped files, so a pack cut from an older generation, or one that lost a
// counter, fails rather than refusing a real McDonald's price in silence.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FOOD_PACK_DIR_NAME,
  FOOD_PACK_FILE_NAME,
  foodPackBody,
  foodRowsFromLayer,
} from "../scripts/build_london_food_pack.mjs";
import type { CommunityPrice } from "@/lib/communityPrice";
import { COMMUNITY_PRICE_MAX_AGE_MS } from "@/lib/communityPrice";
import {
  FOOD_PLACE_PRICE_REFUSAL,
  LONDON_FOOD_PACK_PATH,
  foodPlacePriceRefusal,
  foodPlacePriceStanding,
  isFoodPlacePriceSubtype,
  isMcDonaldsName,
  londonMcDonalds,
  luciaMcDonaldsRows,
  parseLondonFoodPack,
  type LondonFoodPlace,
} from "@/lib/londonFoodPlaces";
import { londonFoodPlaceSelection } from "@/lib/pubMap";
import { isPubVenueKind } from "@/lib/venueKindFilters";
import { RUNTIME_DATA_PACKS } from "@/lib/venueIndexTracing.mjs";

const PUBLIC = path.join(__dirname, "..", "public");

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(PUBLIC, relative.replace(/^\//, "")), "utf8"));
}

const manifest = readJson("data/london_venues/manifest.json") as {
  urlPrefix: string;
  shards: { id: string; count: number }[];
  countsByKind: Record<string, number>;
};
const committedPack = readJson(LONDON_FOOD_PACK_PATH) as {
  layer: string;
  count: number;
  venues: unknown[][];
};

describe("the committed London food pack", () => {
  it("lives where the map, the page and the route read it", () => {
    expect(LONDON_FOOD_PACK_PATH).toBe(`/data/${FOOD_PACK_DIR_NAME}/${FOOD_PACK_FILE_NAME}`);
  });

  it("is every food row of the committed shards, cut from their generation", async () => {
    const rows = await foodRowsFromLayer(manifest, async (url) => readJson(url));
    expect(committedPack).toEqual(JSON.parse(JSON.stringify(foodPackBody(manifest, rows))));
    expect(committedPack.layer).toBe(manifest.urlPrefix);
    expect(committedPack.count).toBe(manifest.countsByKind.food);
  });

  it("decodes in full, every row a food kind no pub lane reads, under its budget", () => {
    const places = parseLondonFoodPack(committedPack);
    expect(places).toHaveLength(committedPack.count);
    expect(places?.every((place) => place.kind === "food" && place.id.startsWith("venue-osm-"))).toBe(true);
    expect(isPubVenueKind("food")).toBe(false);
    expect(readFileSync(path.join(PUBLIC, LONDON_FOOD_PACK_PATH)).byteLength).toBeLessThan(64 * 1024);
  });

  it("holds the London McDonald's the shards hold, and only what OSM names", () => {
    const places = parseLondonFoodPack(committedPack) ?? [];
    const mcdonalds = londonMcDonalds(places);
    expect(mcdonalds.length).toBeGreaterThanOrEqual(35);
    expect(mcdonalds.every((place) => isMcDonaldsName(place.name))).toBe(true);
    // The layer is cut by a box, so a counter outside every borough is not London's.
    expect(mcdonalds.every((place) => place.borough !== "")).toBe(true);
    expect(places.some((place) => isMcDonaldsName(place.name) && place.borough === "")).toBe(true);
    expect(mcdonalds.some((place) => place.name === "Subway")).toBe(false);
  });

  it("is declared for file tracing, so the deployed route can read it", () => {
    expect(RUNTIME_DATA_PACKS.find((pack) => pack.id === "london-food-pack")).toEqual({
      id: "london-food-pack",
      modules: ["lib/londonFoodIndex.server.ts"],
      files: [`./public${LONDON_FOOD_PACK_PATH}`],
    });
  });

  it("refuses a pack that lost a row or names another kind", () => {
    expect(parseLondonFoodPack({ ...committedPack, count: committedPack.count + 1 })).toBeNull();
    expect(parseLondonFoodPack({ ...committedPack, kind: "restaurant" })).toBeNull();
    const cafeRow = [...(committedPack.venues[0] ?? [])];
    cafeRow[5] = "cafe";
    expect(parseLondonFoodPack({ ...committedPack, venues: [cafeRow], count: 1 })).toBeNull();
  });
});

describe("the counter price lane", () => {
  it("names McDonald's as OSM spells it, and nothing that merely contains it", () => {
    for (const name of ["McDonald's", "McDonald’s", "McDonalds", "Mc Donald's Drive Thru"]) {
      expect(isMcDonaldsName(name), name).toBe(true);
    }
    for (const name of ["Subway", "Old McDonald's Farm Shop", "Beigel Bake"]) {
      expect(isMcDonaldsName(name), name).toBe(false);
    }
  });

  it("admits a soft drink said to be a Coke Zero or a Diet Coke, and nothing else", () => {
    for (const subtype of ["soft-drink-lucia-special", "soft-drink-coke-zero", "soft-drink-diet-coke"]) {
      expect(foodPlacePriceRefusal({ drinkCategory: "soft-drink", drinkSubtype: subtype })).toBeNull();
      expect(isFoodPlacePriceSubtype(subtype)).toBe(true);
    }
    for (const subtype of [undefined, "", "soft-drink-pepsi-max", "soft-drink-zero-sugar-cola", "soft-drink-still-water"]) {
      expect(foodPlacePriceRefusal({ drinkCategory: "soft-drink", drinkSubtype: subtype })).toBe(
        FOOD_PLACE_PRICE_REFUSAL,
      );
    }
    for (const drinkCategory of ["beer", "wine", "coffee", "alcohol-free", "nonsense"]) {
      expect(
        foodPlacePriceRefusal({ drinkCategory, drinkSubtype: "soft-drink-lucia-special" }),
      ).toBe(FOOD_PLACE_PRICE_REFUSAL);
    }
  });
});

const NOW = Date.parse("2026-10-17T18:00:00Z");
const DAY = 86_400_000;

function softDrink(
  venueId: string,
  priceGbp: number,
  ageDays: number,
  extra: Partial<CommunityPrice> = {},
): CommunityPrice {
  return {
    venueId,
    drinkCategory: "soft-drink",
    priceGbp,
    submittedAt: NOW - ageDays * DAY,
    source: "community",
    corroborations: 1,
    ...extra,
  };
}

describe("what a counter's price says", () => {
  it("reads an agreed figure off the corroborated candidate, as a pin would", () => {
    expect(
      foodPlacePriceStanding(
        [
          softDrink("v", 2.09, 1, {
            mapCandidate: { priceGbp: 1.79, submittedAt: NOW - 3 * DAY, corroborations: 2 },
          }),
        ],
        NOW,
      ),
    ).toEqual({ kind: "agreed", priceGbp: 1.79, submittedAt: NOW - 3 * DAY, corroborations: 2 });
  });

  it("names a lone in-window report as one voice, and an old one as nothing", () => {
    expect(foodPlacePriceStanding([softDrink("v", 1.79, 2)], NOW)).toEqual({
      kind: "logged-once",
      priceGbp: 1.79,
      submittedAt: NOW - 2 * DAY,
    });
    const tooOld = COMMUNITY_PRICE_MAX_AGE_MS / DAY + 1;
    expect(foodPlacePriceStanding([softDrink("v", 1.79, tooOld)], NOW)).toEqual({ kind: "none" });
    expect(foodPlacePriceStanding(undefined, NOW)).toEqual({ kind: "none" });
  });

  it("never reads another category's figure", () => {
    expect(
      foodPlacePriceStanding([{ ...softDrink("v", 4.5, 1, { corroborations: 3 }), drinkCategory: "beer" }], NOW),
    ).toEqual({ kind: "none" });
  });
});

describe("the Lucia McDonald's list", () => {
  const place = (id: string, borough: string, name = "McDonald's"): LondonFoodPlace => ({
    id,
    name,
    address: `${id} High Street`,
    lat: 51.5,
    lng: -0.1,
    kind: "food",
    borough,
  });

  it("leads with agreed figures cheapest first, then one-voice reports newest first, then doors", () => {
    const places = [
      place("venue-osm-a", "Camden"),
      place("venue-osm-b", "Brent"),
      place("venue-osm-c", "Croydon"),
      place("venue-osm-d", "Hackney"),
      place("venue-osm-e", "Ealing"),
      place("venue-osm-s", "Brent", "Subway"),
      place("venue-osm-x", ""),
    ];
    const prices = new Map<string, CommunityPrice[]>([
      ["venue-osm-a", [softDrink("venue-osm-a", 1.99, 1, { corroborations: 2 })]],
      ["venue-osm-c", [softDrink("venue-osm-c", 1.69, 4, { corroborations: 3 })]],
      ["venue-osm-d", [softDrink("venue-osm-d", 1.99, 5)]],
      ["venue-osm-e", [softDrink("venue-osm-e", 1.49, 1)]],
      ["venue-osm-s", [softDrink("venue-osm-s", 1.0, 1, { corroborations: 4 })]],
    ]);
    const rows = luciaMcDonaldsRows(places, prices, NOW);
    expect(rows.map((row) => [row.venueId, row.standing.kind])).toEqual([
      ["venue-osm-c", "agreed"],
      ["venue-osm-a", "agreed"],
      ["venue-osm-e", "logged-once"],
      ["venue-osm-d", "logged-once"],
      ["venue-osm-b", "none"],
    ]);
  });
});

describe("the map's counter selection", () => {
  const counter = { id: "venue-osm-n971874127" };
  const byId = new Map([[counter.id, counter]]);

  it("opens a counter the pack holds, and holds a selection while the pack loads", () => {
    expect(
      londonFoodPlaceSelection({ shown: true, selectedVenueId: counter.id, status: "ready", byId }),
    ).toEqual({ place: counter, release: false });
    expect(
      londonFoodPlaceSelection({ shown: true, selectedVenueId: counter.id, status: "loading", byId: new Map() }),
    ).toEqual({ place: null, release: false });
  });

  it("lets go of an id the settled pack does not hold, or any id off a London map", () => {
    expect(
      londonFoodPlaceSelection({ shown: true, selectedVenueId: "venue-osm-n1", status: "ready", byId }),
    ).toEqual({ place: null, release: true });
    expect(
      londonFoodPlaceSelection({ shown: false, selectedVenueId: counter.id, status: "idle", byId }),
    ).toEqual({ place: null, release: true });
    expect(
      londonFoodPlaceSelection({ shown: true, selectedVenueId: "venue-1f5ygjb", status: "idle", byId }),
    ).toEqual({ place: null, release: false });
  });
});
