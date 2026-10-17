import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { importReviewedDrinkPrices } from "@/scripts/refresh_drink_prices.mjs";
import { drinkFromPriceUpdate, parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import fixture from "@/__tests__/fixtures/harvest/eagle-reviewed-drinks-20261013.json";
import baseline from "@/__tests__/fixtures/harvest/drink-legacy-baseline-a3a21996f.json";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const PDF_BYTES = Buffer.from("%PDF-1.7\nreviewed fixture checksum boundary\n");
let scratch: string;

beforeEach(() => { scratch = mkdtempSync(join(tmpdir(), "pubmax-reviewed-drinks-")); });
afterEach(() => { rmSync(scratch, { recursive: true, force: true }); });

function input() {
  return {
    version: 1,
    sourceId: "youngs-official",
    venueId: fixture.venueId,
    venueKey: fixture.updates[0]!.venueKey,
    sourceUrl: fixture.updates[0]!.source.url,
    sourcePageUrl: fixture.sourcePageUrl,
    observedAt: fixture.updates[0]!.observedAt,
    sourcePdfSha256: sha(PDF_BYTES),
    updates: structuredClone(fixture.updates),
  };
}

function prepare(value: ReturnType<typeof input>) {
  const inputPath = join(scratch, "reviewed.json");
  const sourcePdfPath = join(scratch, "source.pdf");
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(inputPath, text);
  writeFileSync(sourcePdfPath, PDF_BYTES);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response("User-agent: *\nDisallow:\n", { status: 200 }));
  return { inputPath, options: { expectedSha256: sha(text), sourcePdfPath,
    scratchDir: join(scratch, "output"), fetchImpl }, fetchImpl };
}

describe("bounded reviewed drink import", () => {
  it("publishes 22 distinct Eagle servings while preserving every legacy row and rating ID", async () => {
    const prepared = prepare(input());
    const result = await importReviewedDrinkPrices(prepared.inputPath, prepared.options);
    const current = JSON.parse(readFileSync("public/data/drink_price_updates/latest.json", "utf8"));
    const body = result.written
      ? JSON.parse(readFileSync(join(prepared.options.scratchDir, "latest.json"), "utf8"))
      : current;
    const existing = current.updates.slice(0, 1563);

    expect(result.addedRows).toBe(current.updates.length === 1563 ? 22 : 0);
    expect(result.totalRows).toBe(1585);
    expect(body.updates.slice(0, 1563)).toEqual(existing);
    expect(sha(JSON.stringify(body.updates.slice(0, 1563)))).toBe(baseline.sourceRowsSha256);
    const parsed = parseDrinkPriceUpdates(body.updates, NOW);
    expect(parsed).toHaveLength(1585);
    expect(sha(JSON.stringify(parsed.slice(0, 1563).map((row) => drinkFromPriceUpdate(row).id)))).toBe(baseline.ratingIdsSha256);
    const eagle = parsed.filter((row) => row.venueKey === fixture.updates[0]!.venueKey);
    expect(eagle).toHaveLength(22);
    expect(new Set(eagle.map((row) => drinkFromPriceUpdate(row).id)).size).toBe(22);
    expect(eagle.filter((row) => row.servingSize).map((row) => [row.servingSize, row.priceGbp])).toEqual([
      ["125ml", 7.1], ["750ml", 35.5], ["125ml", 8.9], ["750ml", 46.5],
    ]);
    expect(eagle.filter((row) => row.category === "alcohol-free")).toHaveLength(12);
    expect(eagle.every((row) => row.abv === undefined)).toBe(true);
    expect(body.generatedAt).toBe("2026-10-13T10:19:25.911Z");
    if (result.written) {
      expect(body.reviewedImports[0].inputSha256).toBe(prepared.options.expectedSha256);
      expect(body.reviewedImports[0].sourcePdfSha256).toBe(sha(PDF_BYTES));
    } else {
      expect(existsSync(prepared.options.scratchDir)).toBe(false);
      expect(body).toEqual(current);
    }
  });

  it.each(["venue", "source", "row-source", "licence", "source-copy", "rating-id", "duplicate", "calories", "abv", "currency", "precision"])(
    "refuses a %s mismatch before any request or write", async (kind) => {
      const value = input();
      if (kind === "venue") value.venueId = "venue-another-pub";
      if (kind === "source") value.sourceUrl = "https://www.nicholsonspubs.co.uk/menu";
      if (kind === "row-source") value.updates[0]!.source.url = "https://example.org/menu";
      if (kind === "licence") value.updates[0]!.source.licence = "Public domain";
      if (kind === "source-copy") Object.assign(value.updates[0]!.source, { description: "Unreviewed publisher copy" });
      if (kind === "rating-id") Object.assign(value.updates[0]!, { itemId: "drink-14eicaz" });
      if (kind === "duplicate") value.updates[1] = structuredClone(value.updates[0]!);
      if (kind === "calories") Object.assign(value.updates[0]!, { caloriesKcal: 28 });
      if (kind === "abv") Object.assign(value.updates[0]!, { abv: 0 });
      if (kind === "currency") Object.assign(value.updates[0]!, { currency: "not-printed" });
      if (kind === "precision") value.updates[0]!.priceGbp = 7.123;
      const prepared = prepare(value);

      await expect(importReviewedDrinkPrices(prepared.inputPath, prepared.options)).rejects.toThrow();
      expect(prepared.fetchImpl).not.toHaveBeenCalled();
      expect(existsSync(prepared.options.scratchDir)).toBe(false);
    },
  );

  it("refuses a changed reviewed input or source PDF before any write", async () => {
    const prepared = prepare(input());
    await expect(importReviewedDrinkPrices(prepared.inputPath, {
      ...prepared.options, expectedSha256: "0".repeat(64),
    })).rejects.toThrow("input checksum mismatch");
    writeFileSync(prepared.options.sourcePdfPath, "%PDF-1.7\ndifferent source\n");
    await expect(importReviewedDrinkPrices(prepared.inputPath, prepared.options)).rejects.toThrow("PDF checksum mismatch");
    expect(existsSync(prepared.options.scratchDir)).toBe(false);
  });

  it("refuses unreadable robots permission without creating output", async () => {
    const prepared = prepare(input());
    prepared.fetchImpl.mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(importReviewedDrinkPrices(prepared.inputPath, prepared.options)).rejects.toThrow("robots refusal");
    expect(existsSync(prepared.options.scratchDir)).toBe(false);
  });
});
