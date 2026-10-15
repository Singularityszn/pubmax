import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFoodPriceUpdatesToMenu, parseFoodPriceUpdates } from "@/lib/foodPriceUpdates";
import { defined } from "@/__tests__/helpers/defined";
import receipt from "../data/enrichment/firecrawl/london/menu-review-20261013.json";

type SourceRow = Record<string, unknown> & {
  venueKey: string;
  itemName: string;
  category: string;
  caloriesKcal?: number;
};

function snapshot(filename: string): { generatedAt: string; updates: SourceRow[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "public/data/food_price_updates", filename), "utf8"));
}

const venue = defined(receipt.rows[0]);
const expectedByName = new Map(venue.sourceNutritionObservations.map((fact) => [fact.itemName, fact]));
const expectedIds = new Map(receipt.sourceInputImport.itemIds.map((item) => [item.itemName, item]));
const original = snapshot("prices_20260711.json");

describe("committed Eagle menu receipt", () => {
  it("keeps every candidate free of publisher descriptions", () => {
    expect(venue.candidateFoodItems).toHaveLength(42);
    for (const item of venue.candidateFoodItems) {
      expect(Object.hasOwn(item, "description")).toBe(false);
    }
  });

  it("retains only item, price, portion and calorie facts in each nutrition excerpt", () => {
    expect(venue.sourceNutritionObservations).toHaveLength(42);
    for (const fact of venue.sourceNutritionObservations) {
      const item = defined(venue.candidateFoodItems.find((candidate) => candidate.itemName === fact.itemName));
      const lines = fact.sourceExcerpt.split("\n");
      const serving = "servingSize" in fact ? fact.servingSize : undefined;
      expect(lines.length).toBe(serving ? 3 : 2);
      const nameAndPrice = lines[0];
      const calories = lines.at(-1);
      if (serving) expect(lines[1]).toBe(serving);
      const [name, price] = defined(nameAndPrice).split("£");
      expect(defined(name).trim()).toBe(item.itemName);
      expect(Number(defined(price))).toBe(item.priceGbp);
      expect(calories).toBe(`${fact.sourceStatedCaloriesKcal}kcal`);
    }
  });
});

describe.each(["latest.json", "prices_20261013.json"])("Eagle calorie source import in %s", (filename) => {
  it("preserves all 2,530 prior rows exactly", () => {
    expect(snapshot(filename).updates.slice(0, 2530)).toEqual(original.updates);
  });

  it("attaches only the 42 exact item-local calorie observations to their existing price rows", () => {
    const data = snapshot(filename);
    const imported = data.updates.filter((row) => row.venueKey === venue.venueKey);
    expect(imported).toHaveLength(42);
    expect(imported.filter((row) => row.caloriesKcal !== undefined)).toHaveLength(42);
    for (const row of imported) {
      const fact = defined(expectedByName.get(row.itemName));
      const identity = defined(expectedIds.get(row.itemName));
      expect(row.category).toBe(identity.category);
      expect(row.caloriesKcal).toBe(fact.sourceStatedCaloriesKcal);
      expect(row.source).toMatchObject({ url: venue.sourceUrl });
      expect(row.source).toMatchObject({
        licence: "All rights reserved - first-party publisher of its own pub menu. Attributed menu price and calorie facts only, with the observation date and link. No publisher descriptions are republished.",
      });
      expect(row.observedAt).toBe(venue.observedAt);
      expect(row.dietary).toBeUndefined();
      expect(row.description).toBeUndefined();
    }
  });

  it("preserves each stable imported item identity and source through runtime parsing", () => {
    const data = snapshot(filename);
    const updates = parseFoodPriceUpdates(data, Date.parse(data.generatedAt));
    expect(updates).toHaveLength(2620);
    const menu = applyFoodPriceUpdatesToMenu(venue.venueKey, [], updates);
    expect(menu).toHaveLength(42);
    for (const item of menu) {
      const identity = defined(expectedIds.get(item.name));
      const fact = defined(expectedByName.get(item.name));
      expect(item.id).toBe(identity.id);
      expect(item).toMatchObject({ caloriesKcal: fact.sourceStatedCaloriesKcal });
      expect(item.source).toBe(venue.sourceUrl);
      expect(item.provenance.observedAt).toBe(venue.observedAt);
      expect(item).toMatchObject({
        caloriesProvenance: { sourceUrl: venue.sourceUrl, observedAt: venue.observedAt },
      });
    }
  });
});
