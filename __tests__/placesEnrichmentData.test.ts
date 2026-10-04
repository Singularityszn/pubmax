import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

it("keeps copied content limited to verified identities and individually dated authorised fields", () => {
  const pack = read("data/places_enrichment.json");
  const verified = new Map(read("data/places_verification/london.json").pubs.map((row: {venueId: string; googlePlaceId: string}) => [row.venueId, row.googlePlaceId]));
  const fields = ["regularOpeningHours", "formattedAddress", "nationalPhoneNumber", "websiteUri"];
  const dates: string[] = [];
  const ids = new Set<string>();
  expect(pack.version).toBe(1);
  for (const row of pack.venues) {
    expect(ids.has(row.venueId)).toBe(false);
    ids.add(row.venueId);
    expect(row.googlePlaceId).toBe(verified.get(row.venueId));
    expect(Object.keys(row).every(key => ["venueId", "googlePlaceId", ...fields].includes(key))).toBe(true);
    for (const field of fields) {
      if (!row[field]) continue;
      const observation = row[field];
      expect(Object.keys(observation).sort()).toEqual(["observedAt", "source", "value"]);
      expect(observation.source).toBe("google_places");
      expect(Number.isFinite(Date.parse(observation.observedAt))).toBe(true);
      dates.push(observation.observedAt);
      if (field === "regularOpeningHours") {
        expect(Array.isArray(observation.value.periods)).toBe(true);
        expect(Object.keys(observation.value).every(key => ["periods", "weekdayDescriptions"].includes(key))).toBe(true);
      } else expect(typeof observation.value).toBe("string");
    }
  }
  expect(pack.observedAt).toBe(dates.sort()[0]);
  expect(pack.summary.venues).toBe(ids.size);
  expect(pack.spend.reservedUsd).toBe(pack.spend.attemptedCalls * 2 / 100);
  expect(pack.spend.reservedUsd).toBeLessThanOrEqual(pack.spend.capUsd);
  expect(pack.spend.capUsd).toBeLessThanOrEqual(85);
  expect(pack.spend.priorReservedUsd).toBe(pack.spend.priorAttemptedCalls * 2 / 100);
  expect(pack.spend.priorAttemptedCalls + pack.spend.attemptedCalls).toBeGreaterThanOrEqual(ids.size);
  expect(pack.summary.errors).toBe(pack.errors.length);
});
