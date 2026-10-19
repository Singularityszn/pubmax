import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { drinkFromPriceUpdate, parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import { menuOwnerVerdict, readMenuPageOwners, venueKeyPoint } from "@/scripts/lib/menuPageOwners.mjs";
import receipt from "@/data/enrichment/firecrawl/london/eagle-drinks-reviewed-20261013.json";
import baseline from "@/__tests__/fixtures/harvest/drink-legacy-baseline-a3a21996f.json";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const NOW = Date.parse("2026-10-13T12:00:00.000Z");

type UpdateRow = { venueKey: string; itemId?: unknown; source?: { url?: string } };

describe("reviewed Eagle source snapshot", () => {
  it("publishes exactly the reviewed atoms and preserves all earlier prices and rating IDs", () => {
    const latest = JSON.parse(readFileSync("public/data/drink_price_updates/latest.json", "utf8"));
    const edition = JSON.parse(readFileSync("public/data/drink_price_updates/prices_20261013.json", "utf8"));
    const legacy = edition.updates.filter((row: UpdateRow) => row.itemId === undefined);
    const newRows = latest.updates.filter((row: UpdateRow) => row.venueKey === receipt.venueKey);

    // The edition is the 13 October import as written. latest.json is that
    // edition less the 415 Greene King rows whose menu is another pub's
    // (`npm run prices:drop-wrong-pub`), and nothing else.
    const owners = readMenuPageOwners(process.cwd());
    const ownMenu = (row: UpdateRow) =>
      menuOwnerVerdict(row.source?.url, venueKeyPoint(row.venueKey), owners).verdict !== "other-pub";
    expect(latest).toEqual({ ...edition, updates: edition.updates.filter(ownMenu) });
    expect(edition.updates).toHaveLength(1585);
    expect(latest.updates).toHaveLength(1170);
    expect(parseDrinkPriceUpdates(latest, NOW)).toHaveLength(1170);
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
