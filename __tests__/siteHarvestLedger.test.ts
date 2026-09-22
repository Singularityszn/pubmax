import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
});
