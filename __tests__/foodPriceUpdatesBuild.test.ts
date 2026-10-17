import { describe, expect, it } from "vitest";

import { parseFoodPriceUpdates } from "@/lib/foodPriceUpdates";
import { buildFoodPricePack, publishedFoodRow } from "../scripts/build_food_price_updates.mjs";
import {
  curatedFoodTargets,
  osmFoodTargets,
  parseFoodHarvestArgs,
  ukBaseVenueId,
} from "../scripts/harvest/uk-food/run.mjs";
import { FIRST_PARTY_FOOD_LICENCE } from "../scripts/harvest/uk-food/lane.mjs";

const NOW = Date.parse("2026-10-17T12:00:00.000Z");

const harvestRow = (venueKey: string, itemName: string, priceGbp: number, observedAt = "2026-10-17T11:00:00.000Z") => ({
  venueKey,
  venueId: venueKey,
  itemName,
  category: "mains",
  priceGbp,
  source: { label: "example-arms.test — the pub's own website", url: "https://www.example-arms.test/food/", licence: FIRST_PARTY_FOOD_LICENCE },
  observedAt,
  readVia: "served",
  quote: `${itemName} £${priceGbp.toFixed(2)}`,
});

const earlierRow = (venueKey: string, itemName: string) => ({
  venueKey,
  itemName,
  category: "mains",
  priceGbp: 9.99,
  source: { label: "Earlier import", url: "https://www.example-old.test/menu", licence: "Attributed use only." },
  observedAt: "2026-07-11T12:00:00.000Z",
});

describe("build:food-price-updates", () => {
  it("publishes the price fact and its provenance, never the menu's own copy", () => {
    const published = publishedFoodRow(harvestRow("venue-arms", "Fish Pie", 15));
    expect(Object.keys(published).sort()).toEqual(["category", "itemName", "observedAt", "priceGbp", "source", "venueKey"]);
    expect(JSON.stringify(published)).not.toContain("quote");
  });

  it("replaces every older row of a pub it re-read, and keeps the pubs it did not", () => {
    const { pack, summary } = buildFoodPricePack({
      existing: { updates: [earlierRow("venue-arms", "Old Dish"), earlierRow("venue-other", "Kept Dish")] },
      harvested: [harvestRow("venue-arms", "Fish Pie", 15), harvestRow("venue-arms", "Steak Pie", 16)],
      now: NOW,
    });
    expect(pack.updates.map((row: { venueKey: string; itemName: string }) => `${row.venueKey}|${row.itemName}`)).toEqual([
      "venue-arms|Fish Pie",
      "venue-arms|Steak Pie",
      "venue-other|Kept Dish",
    ]);
    expect(summary).toMatchObject({ accepted: 2, venuesRestated: 1, rowsKeptFromEarlierReads: 1, rows: 3 });
  });

  it("derives generatedAt from the newest row rather than the clock", () => {
    const { pack } = buildFoodPricePack({
      existing: { updates: [] },
      harvested: [harvestRow("venue-a", "Fish Pie", 15, "2026-10-16T20:00:00.000Z"), harvestRow("venue-b", "Pie", 14, "2026-10-17T09:30:00.000Z")],
      now: NOW,
    });
    expect(pack.generatedAt).toBe("2026-10-17T09:30:00.000Z");
  });

  it("writes a pack the Menu tab's own parser accepts in full", () => {
    const { pack } = buildFoodPricePack({ existing: { updates: [] }, harvested: [harvestRow("venue-arms", "Fish Pie", 15)], now: NOW });
    expect(parseFoodPriceUpdates(pack, Date.parse(pack.generatedAt))).toHaveLength(pack.updates.length);
  });

  it("refuses to publish when nothing honest was harvested", () => {
    expect(() => buildFoodPricePack({ existing: { updates: [] }, harvested: [], now: NOW })).toThrow(/no harvested food rows/);
    const future = harvestRow("venue-arms", "Fish Pie", 15, "2027-01-01T00:00:00.000Z");
    const noCategory = { ...harvestRow("venue-arms", "Pie", 15), category: "brunch-ish" };
    expect(() => buildFoodPricePack({ existing: { updates: [] }, harvested: [future, noCategory], now: NOW })).toThrow(/none of the 2/);
  });
});

describe("harvest:uk-food targets and flags", () => {
  it("keys a curated venue by its own id and reads its operator's menu URL", () => {
    const targets = curatedFoodTargets(
      { venues: { "venue-x": { menuUrl: "https://www.example-arms.test/food/" }, "venue-y": {} } },
      [{ id: "venue-x", name: "The Example Arms" }],
    );
    expect(targets).toEqual([
      { venueId: "venue-x", venueKey: "venue-x", name: "The Example Arms", menuUrls: ["https://www.example-arms.test/food/"], source: "curated" },
    ]);
  });

  it("takes London OSM pubs with their own site, and leaves social pages, other cities and curated hosts alone", () => {
    const snapshot = {
      pubs: [
        { osmId: "node/1", name: "London Own Site", lat: 51.5, lng: -0.1, website: "example-arms.test" },
        { osmId: "node/2", name: "London Facebook", lat: 51.5, lng: -0.1, website: "https://www.facebook.com/x" },
        { osmId: "node/3", name: "Manchester", lat: 53.48, lng: -2.24, website: "https://www.example-mcr.test/" },
        { osmId: "way/4", name: "Curated Estate", lat: 51.5, lng: -0.1, website: "https://www.example-estate.test/pub" },
        { osmId: "bogus", name: "No Id", lat: 51.5, lng: -0.1, website: "https://www.example-noid.test/" },
      ],
    };
    const targets = osmFoodTargets(snapshot, new Set(["example-estate.test"]));
    expect(targets).toEqual([
      { venueId: "venue-uk-n1", venueKey: "venue-uk-n1", name: "London Own Site", website: "https://example-arms.test/", menuUrls: [], source: "osm" },
    ]);
    expect(ukBaseVenueId("relation/42")).toBe("venue-uk-r42");
  });

  it("refuses a flag it does not know and a budget that is not a positive integer", () => {
    expect(parseFoodHarvestArgs([])).toMatchObject({ source: "all", pages: 8000, renders: 500, render: "auto" });
    expect(() => parseFoodHarvestArgs(["--pages", "0"])).toThrow();
    expect(() => parseFoodHarvestArgs(["--render", "sometimes"])).toThrow();
    expect(() => parseFoodHarvestArgs(["--recheck", "made-up"])).toThrow();
    expect(() => parseFoodHarvestArgs(["--everything"])).toThrow();
  });
});
