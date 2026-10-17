import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { drinkFromPriceUpdate, parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import receipt from "@/data/enrichment/firecrawl/london/eagle-drinks-reviewed-20261013.json";
import baseline from "@/__tests__/fixtures/harvest/drink-legacy-baseline-a3a21996f.json";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const NOW = Date.parse("2026-10-13T12:00:00.000Z");

describe("reviewed Eagle source snapshot", () => {
  it("publishes exactly the reviewed atoms and preserves all earlier prices and rating IDs", () => {
    const latest = JSON.parse(readFileSync("public/data/drink_price_updates/latest.json", "utf8"));
    const edition = JSON.parse(readFileSync("public/data/drink_price_updates/prices_20261013.json", "utf8"));
    const parsed = parseDrinkPriceUpdates(latest, NOW);
    const legacy = latest.updates.filter((row: { itemId?: unknown }) => row.itemId === undefined);
    const newRows = latest.updates.filter((row: { venueKey: string }) => row.venueKey === receipt.venueKey);

    expect(latest).toEqual(edition);
    expect(latest.updates).toHaveLength(1585);
    expect(parsed).toHaveLength(1585);
    expect(legacy).toHaveLength(1563);
    expect(sha(legacy)).toBe(baseline.sourceRowsSha256);
    expect(sha(parseDrinkPriceUpdates(legacy, NOW).map((row) => drinkFromPriceUpdate(row).id))).toBe(baseline.ratingIdsSha256);
    expect(newRows).toHaveLength(22);
    expect(new Set(newRows.map((row: { itemId: string }) => row.itemId)).size).toBe(22);
    expect(newRows.map(({ itemId, ...row }: { itemId: string }) => {
      expect(itemId).toMatch(/^drink-item-[0-9a-f]{16}$/);
      return row;
    })).toEqual(receipt.updates);
    expect(newRows.filter((row: { category: string }) => row.category === "alcohol-free")).toHaveLength(12);
    expect(newRows.filter((row: { servingSize?: string }) => row.servingSize !== undefined)).toHaveLength(4);
    expect(newRows.every((row: Record<string, unknown>) => !("abv" in row) && !("caloriesKcal" in row))).toBe(true);
    expect(latest.generatedAt).toBe(receipt.observedAt);
    expect(latest.reviewedImports[0].sourcePdfSha256).toBe(receipt.sourcePdfSha256);
  });
});
