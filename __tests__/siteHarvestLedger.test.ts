import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  dedupeSiteHarvestLedgerRows,
  loadCuratedUkBaseOwners,
  parseSiteHarvestLedgerText,
  siteHarvestLedgerCollectKey,
  siteHarvestLedgerDuplicateKeys,
} from "@/lib/siteHarvestLedgerCore";
import { defined } from "@/__tests__/helpers/defined";

describe("site harvest ledger", () => {
  const owners = loadCuratedUkBaseOwners();

  it("dedupes on the same collect key the bundle builder uses", () => {
    const older = {
      venueId: "venue-uk-n1",
      category: "beer",
      priceGbp: 5.5,
      observedAt: "2026-09-01T00:00:00.000Z",
      sourceUrl: "https://example.com/menu",
      host: "example.com",
    };
    const newer = { ...older, priceGbp: 6.2, observedAt: "2026-09-21T00:00:00.000Z" };
    const out = dedupeSiteHarvestLedgerRows([older, newer], owners);
    expect(out).toHaveLength(1);
    expect(defined(out[0]).observedAt).toBe(newer.observedAt);
  });

  it("preserves separate explicit servings and collapses only a repeated serving", () => {
    const base = {
      venueId: "venue-uk-n1",
      category: "wine",
      drinkLabel: "House Chardonnay",
      observedAt: "2026-09-29T10:40:17.846Z",
      sourceUrl: "https://www.sydneyarmschelsea.com/menu/",
      host: "www.sydneyarmschelsea.com",
    };
    const rows = [
      { ...base, servingSize: "125ml", priceGbp: 5.5 },
      { ...base, servingSize: "250ml", priceGbp: 11 },
      { ...base, servingSize: "Btl", priceGbp: 31.5 },
      { ...base, priceGbp: 9 },
      { ...base, servingSize: "125ml", priceGbp: 6 },
    ];
    const out = dedupeSiteHarvestLedgerRows(rows, owners);
    expect(out).toHaveLength(4);
    expect(out.map((row) => [row.servingSize, row.priceGbp])).toEqual([
      [undefined, 9], ["125ml", 5.5], ["250ml", 11], ["Btl", 31.5],
    ]);
    expect(siteHarvestLedgerDuplicateKeys(out, owners)).toEqual([]);
  });

  it("lets a re-read wine row supersede one harvested with its measure in the name", () => {
    const legacy = {
      venueId: "venue-uk-n1",
      category: "wine",
      drinkLabel: "Merlot 175ml",
      priceGbp: 7,
      observedAt: "2026-09-01T00:00:00.000Z",
      sourceUrl: "https://example.com/menu",
      host: "example.com",
    };
    const reread = {
      ...legacy,
      drinkLabel: "Merlot",
      servingSize: "175ml",
      priceGbp: 7.5,
      observedAt: "2026-09-21T00:00:00.000Z",
    };
    expect(siteHarvestLedgerCollectKey(legacy, owners)).toBe(siteHarvestLedgerCollectKey(reread, owners));
    expect(dedupeSiteHarvestLedgerRows([legacy, reread], owners)).toEqual([reread]);
    expect(dedupeSiteHarvestLedgerRows([legacy], owners)).toEqual([
      { ...legacy, drinkLabel: "Merlot", servingSize: "175ml" },
    ]);
    const bareMeasure = { ...legacy, drinkLabel: "175ml" };
    expect(dedupeSiteHarvestLedgerRows([bareMeasure], owners)).toEqual([bareMeasure]);
  });

  it("committed site_harvest.jsonl has no duplicate bundle collect keys", () => {
    const text = readFileSync(
      join(process.cwd(), "data/uk_prices/site_harvest.jsonl"),
      "utf8",
    );
    const rows = parseSiteHarvestLedgerText(text);
    expect(siteHarvestLedgerDuplicateKeys(rows, owners)).toEqual([]);
    for (const row of rows) {
      expect(siteHarvestLedgerCollectKey(row, owners)).toBeTruthy();
    }
  });

  it("committed soft-drink ledger excludes robot-refused pages and known alcoholic mislabels", () => {
    const text = readFileSync(
      join(process.cwd(), "data/uk_prices/site_harvest.jsonl"),
      "utf8",
    );
    const rows = parseSiteHarvestLedgerText(text);
    const nicholsonRows = rows.filter((row) => {
      try {
        return typeof row.sourceUrl === "string" &&
          new URL(row.sourceUrl).hostname.toLowerCase().replace(/^www\./, "") === "nicholsonspubs.co.uk";
      } catch {
        return false;
      }
    });
    const refusedSoftDrinkRows = rows.filter(
      (row) => row.category === "soft-drink" && row.robotsDisallowed === true,
    );
    const alcoholicMislabels = rows.filter(
      (row) =>
        row.category === "soft-drink" &&
        /Crabbies Alcoholic ginger beer 3\.4%/i.test(row.drinkLabel ?? ""),
    );
    expect(nicholsonRows).toHaveLength(0);
    expect(refusedSoftDrinkRows).toHaveLength(0);
    expect(alcoholicMislabels).toHaveLength(0);
  });
});
