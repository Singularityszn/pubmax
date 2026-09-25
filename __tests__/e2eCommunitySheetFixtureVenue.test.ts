import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
} from "../e2e/helpers/communitySheetFixture";
import { parseDrinkPriceUpdates } from "@/lib/drinkPriceUpdates";
import { stableVenueIdFromKey } from "@/lib/venues";

const ROOT = path.resolve(__dirname, "..");

function harvestedRowCountForVenue(venueId: string): number {
  const ukRows = JSON.parse(
    readFileSync(path.join(ROOT, "public", "data", "uk_prices", "rows.json"), "utf8"),
  ) as { venueId: string }[];
  const uk = ukRows.filter((row) => stableVenueIdFromKey(row.venueId) === venueId).length;

  const drinkRaw = JSON.parse(
    readFileSync(path.join(ROOT, "public", "data", "drink_price_updates", "latest.json"), "utf8"),
  ) as unknown;
  const generatedAt = Date.parse(
    String((drinkRaw as { generatedAt?: unknown })?.generatedAt ?? ""),
  );
  const drinkRows = parseDrinkPriceUpdates(drinkRaw, Number.isFinite(generatedAt) ? generatedAt : Date.now());
  const drink = drinkRows.filter((row) => stableVenueIdFromKey(row.venueKey) === venueId).length;

  return uk + drink;
}

describe("e2e community sheet fixture venue", () => {
  it("has no harvested uk_prices or drink_price_updates rows", () => {
    const count = harvestedRowCountForVenue(COMMUNITY_SHEET_FIXTURE_VENUE_ID);
    expect(
      count,
      `${COMMUNITY_SHEET_FIXTURE_VENUE_ID} gained ${count} harvested row(s); ` +
        "pick another COMMUNITY_SHEET_FIXTURE_VENUE_ID in e2e/helpers/communitySheetFixture.ts " +
        "or move the specs to a venue that still has community-only sheet state.",
    ).toBe(0);
  });
});
