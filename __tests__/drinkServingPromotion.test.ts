import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  applyDrinkPriceUpdatesToMenu,
  drinkFromPriceUpdate,
  isValidDrinkPriceUpdate,
  mergeDrinkPriceUpdates,
  parseDrinkPriceUpdates,
  reviewedDrinkItemId,
} from "@/lib/drinkPriceUpdates";
import { alcoholTypeForDrink } from "@/lib/drinks";
import fixture from "@/__tests__/fixtures/harvest/eagle-reviewed-drinks-20261013.json";
import baseline from "@/__tests__/fixtures/harvest/drink-legacy-baseline-a3a21996f.json";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const reviewed = fixture.updates.map((row) => ({ ...row, itemId: reviewedDrinkItemId(row) }));
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("reviewed Eagle serving promotion", () => {
  it("retains both publisher wine servings and all 22 priced atoms", () => {
    const updates = parseDrinkPriceUpdates(reviewed, NOW);
    const menu = applyDrinkPriceUpdatesToMenu(fixture.updates[0]!.venueKey, [], updates);

    expect(updates).toHaveLength(22);
    expect(menu).toHaveLength(22);
    expect(new Set(menu.map((drink) => drink.id)).size).toBe(22);
    expect(menu.filter((drink) => drink.name === "Steinbock, Riesling, Germany")
      .map((drink) => [drink.servingSize, drink.priceGbp])).toEqual([
      ["125ml", 7.1],
      ["750ml", 35.5],
    ]);
    expect(menu.filter((drink) => drink.name === "Nooh La Coste Rosé, Provence")
      .map((drink) => [drink.servingSize, drink.priceGbp])).toEqual([
      ["125ml", 8.9],
      ["750ml", 46.5],
    ]);
    expect(menu.every((drink) => drink.provenance.sourceUrl === fixture.updates[0]!.source.url)).toBe(true);
    expect(menu.every((drink) => drink.provenance.observedAt === "2026-10-13T10:19:25.911Z")).toBe(true);
  });

  it("never puts a glass quote on a bottle or an unstated serving", () => {
    const glass = reviewed[0]!;
    const bottle = reviewed[1]!;
    const updates = parseDrinkPriceUpdates([glass, bottle], NOW);
    const rows = [
      { venueKey: glass.venueKey, drinkName: glass.drinkName, category: "alcohol-free" as const,
        servingSize: "125ml", priceGbp: null, latestContributorAt: null },
      { venueKey: glass.venueKey, drinkName: glass.drinkName, category: "alcohol-free" as const,
        servingSize: "750ml", priceGbp: null, latestContributorAt: null },
      { venueKey: glass.venueKey, drinkName: glass.drinkName, category: "alcohol-free" as const,
        priceGbp: null, latestContributorAt: null },
    ];
    const merged = mergeDrinkPriceUpdates(rows, updates, (row) => row.venueKey);

    expect(merged.map((row) => row.priceGbp)).toEqual([7.1, 35.5, null]);
    expect(merged[2]!.sourcedPrice).toBeNull();
  });

  it("rejects an arbitrary item ID that could claim an existing rating", () => {
    expect(isValidDrinkPriceUpdate({ ...fixture.updates[0], itemId: "drink-existing-rating" }, NOW)).toBe(false);
  });

  it("preserves the publisher AF category without inventing a numeric ABV", () => {
    const afUpdates = parseDrinkPriceUpdates(reviewed.filter((row) => row.category === "alcohol-free"), NOW);
    const drinks = afUpdates.map(drinkFromPriceUpdate);

    expect(drinks).toHaveLength(12);
    expect(drinks.every((drink) => drink.alcoholType === "low-no")).toBe(true);
    expect(drinks.every((drink) => drink.abv === undefined)).toBe(true);
  });

  it("keeps a stated numeric ABV authoritative over an AF category", () => {
    const update = parseDrinkPriceUpdates([{ ...fixture.updates[4], abv: 5 }], NOW)[0]!;
    expect(drinkFromPriceUpdate(update).alcoholType).toBe("alcoholic");
    expect(alcoholTypeForDrink({ name: "Unlabelled drink" })).toBe("unknown");
  });

  it("rejects repeated explicit item IDs instead of choosing an arbitrary price", () => {
    expect(parseDrinkPriceUpdates([reviewed[0], { ...reviewed[0], priceGbp: 1 }], NOW)).toEqual([]);
  });

  it("rejects a supplied ID when its venue, item, category or serving changes", () => {
    const first = reviewed[0]!;
    for (const changed of [
      { ...first, venueKey: "another venue" },
      { ...first, drinkName: "Another wine" },
      { ...first, category: "wine" },
      { ...first, servingSize: "750ml" },
      { ...first, itemId: null },
      { ...first, itemId: 123 },
      { ...first, itemId: "" },
    ]) {
      expect(isValidDrinkPriceUpdate(changed, NOW)).toBe(false);
    }
  });

  it("rejects ambiguous legacy servings that would share one rating ID", () => {
    expect(parseDrinkPriceUpdates(fixture.updates.slice(0, 2), NOW)).toEqual([]);
  });

  it("rejects malformed identity text even when its supplied ID matches", () => {
    for (const changed of [
      { ...fixture.updates[0]!, drinkName: "Wine\u0000another item" },
      { ...fixture.updates[0]!, drinkName: "Wine".repeat(100) },
      { ...fixture.updates[0]!, servingSize: " 125ml " },
    ]) {
      expect(isValidDrinkPriceUpdate({ ...changed, itemId: reviewedDrinkItemId(changed) }, NOW)).toBe(false);
    }
  });

  it("preserves all 1563 legacy rows, observation dates and rating references", () => {
    const raw = JSON.parse(readFileSync("public/data/drink_price_updates/latest.json", "utf8")) as {
      updates: Array<{ itemId?: unknown }>;
    };
    const legacy = raw.updates.filter((row) => row.itemId === undefined);
    const parsed = parseDrinkPriceUpdates(legacy, NOW);

    expect(legacy).toHaveLength(baseline.rawCount);
    expect(sha(legacy)).toBe(baseline.sourceRowsSha256);
    expect(parsed).toHaveLength(baseline.parsedCount);
    expect(sha(parsed.map((row) => drinkFromPriceUpdate(row).id))).toBe(baseline.ratingIdsSha256);
    expect(parsed.filter((row) => row.servingSize).map((row) => ({
      venueKey: row.venueKey,
      drinkName: row.drinkName,
      category: row.category,
      servingSize: row.servingSize,
      id: drinkFromPriceUpdate(row).id,
    }))).toEqual(baseline.statedServingRows);
  });
});
