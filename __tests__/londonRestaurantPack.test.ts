// The committed London restaurant pack is a projection of the committed London
// venue shards. These fences read the shipped files, not a fixture: a pack cut
// from an older shard generation, or one that lost a restaurant, is how the map
// would stop drawing restaurants with nothing saying so.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  RESTAURANT_PACK_DIR_NAME,
  RESTAURANT_PACK_FILE_NAME,
  restaurantPackBody,
  restaurantRowsFromLayer,
} from "../scripts/build_london_restaurant_pack.mjs";
import {
  LONDON_RESTAURANT_PACK_PATH,
  londonRestaurantsPassingMapFilters,
  parseLondonRestaurantPack,
} from "@/lib/londonRestaurants";
import { SEED_BOROUGH_CAMPAIGN } from "@/lib/boroughCoverageStatus";
import { londonVenueIdFor } from "@/lib/londonVenueShards";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { slimVenuesToPins } from "@/lib/slimPins";
import { initialFilters } from "@/lib/venues";
import type { SlimVenue } from "@/lib/venuesSlim";

const PUBLIC = path.join(__dirname, "..", "public");

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(PUBLIC, relative), "utf8"));
}

const manifest = readJson("data/london_venues/manifest.json") as {
  urlPrefix: string;
  shards: { id: string; count: number }[];
  countsByKind: Record<string, number>;
};
const committedPack = readJson(LONDON_RESTAURANT_PACK_PATH) as {
  layer: string;
  count: number;
  venues: unknown[][];
};

function compactOsmRef(osmId: string): string {
  const [type, id] = osmId.split("/");
  return `${type?.[0] ?? ""}${id ?? ""}`;
}

describe("the committed London restaurant pack", () => {
  it("lives where the map reads it", () => {
    expect(LONDON_RESTAURANT_PACK_PATH).toBe(
      `/data/${RESTAURANT_PACK_DIR_NAME}/${RESTAURANT_PACK_FILE_NAME}`,
    );
  });

  it("is every restaurant row of the committed shards, cut from their generation", async () => {
    const rows = await restaurantRowsFromLayer(manifest, async (url) => readJson(url));
    expect(committedPack).toEqual(
      JSON.parse(JSON.stringify(restaurantPackBody(manifest, rows))),
    );
    expect(committedPack.layer).toBe(manifest.urlPrefix);
    expect(committedPack.count).toBe(manifest.countsByKind.restaurant);
  });

  it("holds every restaurant whose own website states it serves alcohol", () => {
    const evidence = JSON.parse(
      readFileSync(
        path.join(__dirname, "..", "data", "london_restaurant_drinks", "evidence.json"),
        "utf8",
      ),
    ) as { rows: { osmId: string }[] };
    const packed = new Set(committedPack.venues.map((row) => row[0]));
    const missing = evidence.rows.filter((row) => !packed.has(compactOsmRef(row.osmId)));
    expect(evidence.rows.length).toBeGreaterThanOrEqual(900);
    expect(missing).toEqual([]);
  });

  it("decodes in full on the map, under its read budget", () => {
    const restaurants = parseLondonRestaurantPack(committedPack);
    expect(restaurants).not.toBeNull();
    expect(restaurants).toHaveLength(committedPack.count);
    expect(restaurants?.[0]?.id).toBe(londonVenueIdFor(String(committedPack.venues[0]?.[0])));
    const bytes = readFileSync(path.join(PUBLIC, LONDON_RESTAURANT_PACK_PATH)).byteLength;
    expect(bytes).toBeLessThan(192 * 1024);
  });

  it("finds a borough's restaurants by the borough's name, as it finds its curated pins", () => {
    const restaurants = parseLondonRestaurantPack(committedPack) ?? [];
    const searched = (query: string) =>
      londonRestaurantsPassingMapFilters(restaurants, {
        filters: { ...initialFilters, query },
        savedOnly: false,
        nearMe: null,
        selectedVenueId: "",
        curated: [],
      });
    for (const borough of ["camden", "westminster", "hackney"]) {
      const byBoroughAlone = searched(borough).filter(
        (place) => !`${place.name} ${place.address}`.toLowerCase().includes(borough),
      );
      expect(byBoroughAlone.length).toBeGreaterThan(40);
    }
  });
});

describe("the borough coverage links", () => {
  it("each show restaurants in the area they name, beside the committed curated pins", () => {
    const restaurants = parseLondonRestaurantPack(committedPack) ?? [];
    const curated = slimVenuesToPins(
      (rowsFromSlimPayload(readJson("data/venues_slim.json")) ?? []) as SlimVenue[],
    );
    expect(curated.length).toBeGreaterThan(1000);
    for (const { mapQuery } of SEED_BOROUGH_CAMPAIGN) {
      const query = mapQuery.toLowerCase();
      const shown = londonRestaurantsPassingMapFilters(restaurants, {
        filters: { ...initialFilters, query: mapQuery },
        savedOnly: false,
        nearMe: null,
        selectedVenueId: "",
        curated,
      });
      const byOwnFields = shown.filter((place) =>
        [place.name, place.address, place.borough].some((field) =>
          field.toLowerCase().includes(query),
        ),
      );
      expect(shown.length, mapQuery).toBeGreaterThanOrEqual(5);
      expect(shown.length, mapQuery).toBeGreaterThan(byOwnFields.length);
      expect(shown.length, mapQuery).toBeLessThan(restaurants.length / 2);
    }
  });
});

describe("restaurantPackBody", () => {
  it("writes each row's borough after it, by the lookup that places curated pins", () => {
    const body = restaurantPackBody({ urlPrefix: "/data/london_venues/", shards: [] }, [
      ["n1", "Rules", "35 Maiden Lane", 51.51083, -0.12319, "restaurant"],
      ["n2", "Far Away", "", 52.2, 0.12, "restaurant"],
    ]);
    expect(body.version).toBe(2);
    expect(body.venues).toEqual([
      ["n1", "Rules", "35 Maiden Lane", 51.51083, -0.12319, "restaurant", "Westminster"],
      ["n2", "Far Away", "", 52.2, 0.12, "restaurant", ""],
    ]);
  });
});

describe("restaurantRowsFromLayer", () => {
  const layer = {
    urlPrefix: "/data/london_venues/packs/0123456789abcdef/",
    shards: [{ id: "a", count: 2 }],
    countsByKind: { restaurant: 1 },
  };
  const shardBody = {
    venues: [
      ["n1", "Desk & Bean", "", 51.5, -0.1, "cafe"],
      ["n2", "Rules", "", 51.51, -0.12, "restaurant"],
    ],
  };

  it("keeps the restaurant rows and reads each shard by its published URL", async () => {
    const urls: string[] = [];
    const rows = await restaurantRowsFromLayer(layer, async (url) => {
      urls.push(url);
      return shardBody;
    });
    expect(urls).toEqual(["/data/london_venues/packs/0123456789abcdef/a.json"]);
    expect(rows).toEqual([["n2", "Rules", "", 51.51, -0.12, "restaurant"]]);
  });

  it("refuses a half-written layer rather than dropping its restaurants", async () => {
    await expect(
      restaurantRowsFromLayer({ ...layer, shards: [{ id: "a", count: 3 }] }, async () => shardBody),
    ).rejects.toThrow(/holds 2 rows, its manifest says 3/);
    await expect(
      restaurantRowsFromLayer({ ...layer, countsByKind: { restaurant: 2 } }, async () => shardBody),
    ).rejects.toThrow(/hold 1 restaurants, the manifest counts 2/);
  });
});
