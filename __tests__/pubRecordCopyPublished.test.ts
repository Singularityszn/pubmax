import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getVenueDetail } from "@/lib/venueDetailIndex";
import { copyFactsForVenue, validateVenueRecordCopy } from "@/lib/venueRecordCopy";
import { groupVenuePrices } from "@/lib/venues";

const ROOT = path.resolve(__dirname, "..");
const pack = JSON.parse(readFileSync(path.join(ROOT, "data/venue_copy/london.json"), "utf8"));

// The pack is checked against the facts each entry records, so a later data
// refresh cannot turn this red. The detail reader omits copy whose facts changed.
describe("published Gemini pub copy", () => {
  it("grounds every entry in its recorded facts, documents every skip and kept its run below USD 15", () => {
    expect(pack.version).toBe(2);
    expect(pack.model).toBe("gemini-2.5-flash-lite");
    expect(pack.sourceDatasetSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pack.runCapUsd).toBe(15);
    expect(Number.isFinite(pack.runSpendUsd)).toBe(true);
    expect(pack.runSpendUsd).toBeGreaterThanOrEqual(0);
    expect(pack.runSpendUsd).toBeLessThanOrEqual(pack.runCapUsd);
    expect(pack.actualSpendUsd).toBeGreaterThan(0);
    expect(pack.actualSpendUsd).toBeGreaterThanOrEqual(pack.runSpendUsd);
    expect(Object.keys(pack.venues).length).toBeGreaterThan(0);
    for (const [venueId, entry] of Object.entries<Record<string, unknown>>(pack.venues)) {
      expect(entry.venueId).toBe(venueId);
      expect(pack.skipped[venueId]).toBeUndefined();
      expect(validateVenueRecordCopy(entry as never, entry), venueId).not.toBeNull();
    }
    for (const skip of Object.values<{ reason: string }>(pack.skipped)) {
      expect(["insufficient-stored-facts", "invalid-copy-after-retry"]).toContain(skip.reason);
    }
  });

  it("returns generated copy through the existing selected-venue reader", async () => {
    const source = JSON.parse(readFileSync(path.join(ROOT, "public/data/pint_prices_app_dataset.json"), "utf8"));
    const current = groupVenuePrices(source).find((venue) =>
      validateVenueRecordCopy(copyFactsForVenue(venue), pack.venues[venue.id]));
    expect(current).toBeDefined();
    const venue = await getVenueDetail(current!.id);
    const { description, vibeTags } = pack.venues[current!.id];
    expect(venue?.recordCopy).toEqual({ description, vibeTags });
  });
});
