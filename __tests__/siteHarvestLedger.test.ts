import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  dedupeSiteHarvestLedgerRows,
  loadCuratedUkBaseOwners,
  parseSiteHarvestLedgerText,
  siteHarvestLedgerCollectKey,
  siteHarvestLedgerDuplicateKeys,
} from "@/lib/siteHarvestLedger";

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
    expect(out[0].observedAt).toBe(newer.observedAt);
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
