import { describe, expect, it } from "vitest";

import type { FoodItem } from "@/lib/food";
import {
  applyFoodPriceUpdatesToMenu,
  parseFoodPriceUpdates,
  type FoodPriceUpdate,
} from "@/lib/foodPriceUpdates";

const OBSERVED_AT = "2026-10-13T06:51:38.364Z";
const NOW = Date.parse("2026-10-14T06:51:38.364Z");
const SOURCE = {
  label: "The Eagle - official published menu",
  url: "https://www.theeaglew12.co.uk/food-drink",
  licence: "First-party facts, with the observation date and link",
};

function row(): FoodPriceUpdate {
  return {
    venueKey: "the-eagle-test",
    itemName: "Mango sorbet (2 scoops)",
    category: "desserts",
    priceGbp: 3.5,
    source: SOURCE,
    observedAt: OBSERVED_AT,
  };
}

function read(raw: unknown): FoodItem[] {
  return applyFoodPriceUpdatesToMenu("the-eagle-test", [], parseFoodPriceUpdates([raw], NOW));
}

describe("publisher calorie facts", () => {
  it("retains dietary evidence separately through a newer price-only update", () => {
    const initial = read({ ...row(), caloriesKcal: 0, dietary: ["vegan"] });
    const next = parseFoodPriceUpdates([{ ...row(), priceGbp: 4, observedAt: "2026-10-14T06:00:00.000Z", source: { ...SOURCE, label: "Later price source", url: "https://www.theeaglew12.co.uk/prices" } }], NOW);
    const [item] = applyFoodPriceUpdatesToMenu("the-eagle-test", initial, next);
    expect(item).toMatchObject({ caloriesKcal: 0, dietary: ["vegan"], priceGbp: 4,
      provenance: { source: "Later price source" },
      dietaryProvenance: { source: SOURCE.label, sourceUrl: SOURCE.url, observedAt: OBSERVED_AT },
      caloriesProvenance: { source: SOURCE.label, sourceUrl: SOURCE.url, observedAt: OBSERVED_AT },
    });
  });
  it("preserves an item-local calorie value and its source through the runtime menu", () => {
    const items = read({ ...row(), caloriesKcal: 52 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Mango sorbet (2 scoops)",
      caloriesKcal: 52,
      source: SOURCE.url,
      provenance: {
        source: SOURCE.label, licence: SOURCE.licence, observedAt: OBSERVED_AT,
      },
      caloriesProvenance: {
        source: SOURCE.label, licence: SOURCE.licence, observedAt: OBSERVED_AT,
        sourceUrl: SOURCE.url,
      },
    });
    expect(items[0]?.dietary).toBeUndefined();
  });

  it("leaves unknown calories absent rather than inventing a zero", () => {
    const items = read(row());
    expect(items[0]).not.toHaveProperty("caloriesKcal");
  });

  it("preserves a publisher-stated zero", () => {
    expect(read({ ...row(), caloriesKcal: 0 })[0]).toMatchObject({ caloriesKcal: 0 });
  });

  it("does not silently round a fractional publisher value", () => {
    expect(read({ ...row(), caloriesKcal: 52.25 })[0]).toMatchObject({ caloriesKcal: 52.25 });
  });

  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "52", ""])(
    "rejects an invalid optional calorie value %s",
    (caloriesKcal) => {
      expect(parseFoodPriceUpdates([{ ...row(), caloriesKcal }], NOW)).toEqual([]);
    },
  );

  it("does not map calorie facts from another venue into this menu", () => {
    const other = parseFoodPriceUpdates([
      { ...row(), venueKey: "another-venue", caloriesKcal: 52 },
    ], NOW);
    expect(applyFoodPriceUpdatesToMenu("the-eagle-test", [], other)).toEqual([]);
  });

  it("replaces the calorie fact when a newer update states one", () => {
    const initial = read({ ...row(), caloriesKcal: 52 });
    const next = parseFoodPriceUpdates([
      { ...row(), priceGbp: 4, caloriesKcal: 54, observedAt: "2026-10-14T06:00:00.000Z" },
    ], NOW);
    const merged = applyFoodPriceUpdatesToMenu("the-eagle-test", initial, next);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ caloriesKcal: 54, priceGbp: 4 });
    expect(merged[0]).toMatchObject({
      caloriesProvenance: { observedAt: "2026-10-14T06:00:00.000Z" },
    });
  });

  it("retains an older calorie fact through a newer price-only observation", () => {
    const initial = read({ ...row(), caloriesKcal: 52 });
    const next = parseFoodPriceUpdates([
      {
        ...row(), priceGbp: 4, observedAt: "2026-10-14T06:00:00.000Z",
        source: { ...SOURCE, label: "Later price source", url: "https://www.theeaglew12.co.uk/prices" },
      },
    ], NOW);
    const merged = applyFoodPriceUpdatesToMenu("the-eagle-test", initial, next);
    expect(merged[0]).toMatchObject({ caloriesKcal: 52, priceGbp: 4 });
    expect(merged[0]).toMatchObject({
      source: "https://www.theeaglew12.co.uk/prices",
      provenance: { observedAt: "2026-10-14T06:00:00.000Z" },
      caloriesProvenance: {
        source: SOURCE.label, licence: SOURCE.licence, observedAt: OBSERVED_AT,
        sourceUrl: SOURCE.url,
      },
    });
  });

  it("replaces an earlier calorie figure with a publisher-stated zero", () => {
    const initial = read({ ...row(), caloriesKcal: 52 });
    const next = parseFoodPriceUpdates([
      { ...row(), caloriesKcal: 0, observedAt: "2026-10-14T06:00:00.000Z" },
    ], NOW);
    expect(applyFoodPriceUpdatesToMenu("the-eagle-test", initial, next)[0])
      .toMatchObject({ caloriesKcal: 0 });
  });

  it("does not accept a calorie-bearing row without a valid source and date", () => {
    expect(parseFoodPriceUpdates([
      { ...row(), caloriesKcal: 52, observedAt: "not-a-date" },
      { ...row(), caloriesKcal: 52, source: { ...SOURCE, url: "not-a-source" } },
    ], NOW)).toEqual([]);
  });
});
