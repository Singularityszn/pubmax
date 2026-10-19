import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { drinkFromPriceUpdate, parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import { menuOwnerVerdict, readMenuPageOwners, venueKeyPoint } from "@/scripts/lib/menuPageOwners.mjs";
import receipt from "@/data/enrichment/firecrawl/london/eagle-drinks-reviewed-20261013.json";
import baseline from "@/__tests__/fixtures/harvest/drink-legacy-baseline-a3a21996f.json";
import { OFFICIAL_SITE_SOURCE_LICENCE } from "@/scripts/lib/tavilyPubEnrichment.mjs";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const NOW = Date.parse("2026-10-13T12:00:00.000Z");

type UpdateRow = { venueKey: string; itemId?: unknown; observedAt?: string; source?: { url?: string; licence?: string } };

/** A row a later nightly London pass appended, read after this snapshot. */
const laterNight = (row: UpdateRow) => Date.parse(row.observedAt ?? "") > NOW;

describe("reviewed Eagle source snapshot", () => {
  it("publishes exactly the reviewed atoms and preserves all earlier prices and rating IDs", () => {
    const latest = JSON.parse(readFileSync("public/data/drink_price_updates/latest.json", "utf8"));
    const edition = JSON.parse(readFileSync("public/data/drink_price_updates/prices_20261013.json", "utf8"));
    const legacy = edition.updates.filter((row: UpdateRow) => row.itemId === undefined);
    const newRows = latest.updates.filter((row: UpdateRow) => row.venueKey === receipt.venueKey);
    const later = latest.updates.filter(laterNight);
    const snapshot = latest.updates.filter((row: UpdateRow) => !laterNight(row));

    // The edition is the 13 October import as written. latest.json is that
    // edition less the 415 Greene King rows whose menu is another pub's
    // (`npm run prices:drop-wrong-pub`). The only rows after it are a later
    // night's official-site readings, appended at the end.
    const owners = readMenuPageOwners(process.cwd());
    const ownMenu = (row: UpdateRow) =>
      menuOwnerVerdict(row.source?.url, venueKeyPoint(row.venueKey), owners).verdict !== "other-pub";
    expect({ ...latest, generatedAt: edition.generatedAt, updates: snapshot }).toEqual({
      ...edition,
      updates: edition.updates.filter(ownMenu),
    });
    expect(latest.updates.slice(0, snapshot.length)).toEqual(snapshot);
    expect(later.every((row: UpdateRow) => row.source?.licence === OFFICIAL_SITE_SOURCE_LICENCE)).toBe(true);
    expect(edition.updates).toHaveLength(1585);
    expect(snapshot).toHaveLength(1170);
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
    if (later.length === 0) expect(latest.generatedAt).toBe(receipt.observedAt);
    else expect(Date.parse(latest.generatedAt)).toBeGreaterThan(NOW);
    expect(latest.reviewedImports[0].sourcePdfSha256).toBe(receipt.sourcePdfSha256);
  });
});
