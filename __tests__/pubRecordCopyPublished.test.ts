import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getVenueDetail } from "@/lib/venueDetailIndex";
import { copyChoicesForVenue, validateVenueRecordCopy } from "@/lib/venueRecordCopy";
import { groupVenuePrices } from "@/lib/venues";

const ROOT = path.resolve(__dirname, "..");

describe("published Gemini pub copy", () => {
  it("accounts for every stored curated pub with supported copy or a documented skip and a metered spend below USD 15", () => {
    const source = readFileSync(path.join(ROOT, "public/data/pint_prices_app_dataset.json"), "utf8");
    const choices = groupVenuePrices(JSON.parse(source)).map(copyChoicesForVenue).filter((choice) => choice !== null);
    const pack = JSON.parse(readFileSync(path.join(ROOT, "data/venue_copy/london.json"), "utf8"));
    expect(pack.model).toBe("gemini-2.5-flash-lite");
    expect(pack.sourceDatasetSha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(pack.actualSpendUsd).toBeGreaterThan(0);
    expect(pack.actualSpendUsd).toBeLessThanOrEqual(15);
    expect([...Object.keys(pack.venues), ...Object.keys(pack.skipped)].sort()).toEqual(choices.map((choice) => choice.venueId).sort());
    for (const choice of choices) {
      if (pack.venues[choice.venueId]) {
        expect(pack.skipped[choice.venueId]).toBeUndefined();
        expect(validateVenueRecordCopy(choice, pack.venues[choice.venueId]), choice.venueId).not.toBeNull();
      } else {
        expect(pack.skipped[choice.venueId].reason).toBe("invalid-selection-after-retry");
      }
    }
  });

  it("returns generated description and vibe tags through the existing selected-venue reader", async () => {
    const venue = await getVenueDetail("venue-1eycmcw");
    expect(venue?.name).toBe("George");
    expect(venue?.recordCopy?.description).toMatch(/^Pub in Bexley\./);
    expect(venue?.recordCopy?.vibeTags.length).toBeGreaterThan(0);
    expect(venue?.recordCopy?.vibeTags.length).toBeLessThanOrEqual(3);
  });
});
