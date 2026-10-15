import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { defined } from "@/__tests__/helpers/defined";
import { applyFoodPriceUpdatesToMenu, parseFoodPriceUpdates, type FoodPriceUpdate } from "@/lib/foodPriceUpdates";
import receipt from "../data/enrichment/firecrawl/london/menu-batch2-review-20261013.json";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
}

function snapshot(filename: string): { generatedAt: string; updates: FoodPriceUpdate[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "public/data/food_price_updates", filename), "utf8"));
}

function expectPreservedRows(priorRows: FoodPriceUpdate[]): void {
  const eagleKey = "the eagle|215 askew rd, london w12 9az, uk|51.50060|-0.23933";
  const targets = priorRows.filter((row) => row.venueKey === eagleKey && row.itemName === "Ice cream");
  expect(targets).toHaveLength(1);
  const target = defined(targets[0]);
  expect(target).toEqual({
    venueKey: eagleKey,
    itemName: "Ice cream",
    category: "desserts",
    priceGbp: 5.5,
    caloriesKcal: 238,
    servingSize: "3 scoops",
    observedAt: "2026-10-13T06:51:38.364Z",
    source: {
      label: "The Eagle - official published menu",
      url: "https://www.theeaglew12.co.uk/food-drink",
      licence: "All rights reserved - first-party publisher of its own pub menu. Attributed menu price and calorie facts only, with the observation date and link. No publisher descriptions are republished.",
    },
  });
  expect(applyFoodPriceUpdatesToMenu(eagleKey, [], [target])).toMatchObject([
    { id: "food-1j3poi9", name: "Ice cream", category: "desserts", priceGbp: 5.5, caloriesKcal: 238, servingSize: "3 scoops" },
  ]);
  const historicalRows = priorRows.map((row) => {
    if (row !== target) return row;
    const historical = { ...row };
    delete historical.servingSize;
    return historical;
  });
  const hash = createHash("sha256").update(JSON.stringify(canonical(historicalRows))).digest("hex");
  expect(hash).toBe(receipt.sourceInputImport.preservedRowsSha256);
}

describe.each(["latest.json", "prices_20261013.json"])("reviewed menu batch in %s", (filename) => {
  it("preserves all 2,572 historical rows with only the approved Eagle serving correction", () => {
    const priorRows = snapshot(filename).updates.slice(0, 2572);
    expectPreservedRows(priorRows);
    expect(priorRows).toEqual(snapshot(filename).updates.slice(0, 2572));
  });

  it.each(["another row", "another serving", "another target field", "different correction", "missing correction"])("rejects historical drift: %s", (mutation) => {
    const priorRows = snapshot(filename).updates.slice(0, 2572);
    const target = defined(priorRows.find((row) => row.venueKey.startsWith("the eagle|") && row.itemName === "Ice cream"));
    if (mutation === "another row") defined(priorRows[0]).priceGbp += 1;
    if (mutation === "another serving") defined(priorRows[0]).servingSize = "3 scoops";
    if (mutation === "another target field") target.caloriesKcal = 239;
    if (mutation === "different correction") target.servingSize = "2 scoops";
    if (mutation === "missing correction") delete target.servingSize;
    expect(() => expectPreservedRows(priorRows)).toThrow();
  });

  it("adds exactly the 48 reviewed rows and uses the actual newest input capture stamp", () => {
    const data = snapshot(filename);
    expect(data.updates).toHaveLength(2620);
    expect(data.updates.slice(2572)).toEqual(receipt.rows.map((row) => row.priceUpdate));
    expect(data.generatedAt).toBe(receipt.sourceInputImport.newestCapturedInputAt);
    expect(parseFoodPriceUpdates(data, Date.parse(data.generatedAt))).toHaveLength(2620);
  });

  it("keeps publisher dietary attributes tied to their own item and legend", () => {
    const imported = snapshot(filename).updates.slice(2572);
    expect(imported.filter((row) => row.dietary !== undefined)).toHaveLength(18);
    expect(imported.filter((row) => row.dietary?.includes("vegan"))).toHaveLength(12);
    expect(imported.filter((row) => row.dietary?.includes("vegetarian"))).toHaveLength(10);
    expect(imported.some((row) => row.dietary?.includes("gluten-free"))).toBe(false);
    for (const observation of receipt.rows) {
      const source = defined(receipt.sources.find((row) => row.venueId === observation.venueId));
      const tags = observation.evidence.dietaryTokens.map((token) =>
        defined(source.dietaryLegend.find((entry) => entry.token === token)).label,
      );
      expect(observation.priceUpdate.dietary ?? []).toEqual(tags);
    }
  });

  it("retains exact calorie facts and each runtime item's source and capture date", () => {
    const data = snapshot(filename);
    const updates = parseFoodPriceUpdates(data, Date.parse(data.generatedAt));
    expect(data.updates.slice(2572).filter((row) => row.caloriesKcal !== undefined)).toHaveLength(47);
    for (const source of receipt.sources) {
      const observations = receipt.rows.filter((row) => row.venueId === source.venueId);
      const menu = applyFoodPriceUpdatesToMenu(defined(observations[0]).priceUpdate.venueKey, [], updates);
      const identities = defined(receipt.identities.find((group) => group.venueId === source.venueId)).items;
      expect(menu).toHaveLength(source.priceCount);
      for (const item of menu) {
        const row = defined(observations.find((entry) => entry.priceUpdate.itemName === item.name)).priceUpdate;
        const identity = defined(identities.find((entry) => entry.name === item.name));
        expect(item.id).toBe(identity.id);
        expect(item.priceGbp).toBe(row.priceGbp);
        expect(item.caloriesKcal).toBe(row.caloriesKcal);
        expect(item.dietary).toEqual(row.dietary);
        expect(item.source).toBe(source.url);
        expect(item.provenance.observedAt).toBe(source.observedAt);
        expect(item.description).toBeUndefined();
        if (row.caloriesKcal !== undefined) {
          expect(item.caloriesProvenance).toMatchObject({
            sourceUrl: source.url, observedAt: source.observedAt,
          });
        }
      }
    }
  });

  it("keeps the anomalous calorie token and optional variants out of runtime facts", () => {
    const imported = snapshot(filename).updates.slice(2572);
    const egg = defined(imported.find((row) => row.itemName === "New Inn Scotch Egg"));
    expect(egg.priceGbp).toBe(5.5);
    expect(egg.caloriesKcal).toBeUndefined();
    expect(receipt.quarantinedObservations).toContainEqual(expect.objectContaining({
      itemName: "New Inn Scotch Egg", sourceToken: "240247kcal",
    }));
    const burger = defined(imported.find((row) => row.itemName === "Narrowboat beef burger"));
    const sausage = defined(imported.find((row) => row.itemName === "Sausage and crushed potatoes"));
    expect(burger.dietary).toBeUndefined();
    expect(sausage.dietary).toBeUndefined();
    expect(imported.some((row) => /^\/?\s*add\b/i.test(row.itemName))).toBe(false);
    expect(imported.find((row) => row.itemName === "8oz Bavette steak")).toBeDefined();
  });
});

it("keeps the latest and dated food packs identical", () => {
  expect(snapshot("latest.json")).toEqual(snapshot("prices_20261013.json"));
});
