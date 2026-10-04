import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

import { readFreshnessArtifact, resolveDatasetStamp } from "@/lib/freshnessArtifact";
import { placesEnrichmentStamp } from "../scripts/lib/placesEnrichmentStamp.mjs";

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
    expect(Object.keys(row).every(key => ["venueId", "googlePlaceId", "observedAt", ...fields].includes(key))).toBe(true);
    expect(Number.isFinite(Date.parse(row.observedAt))).toBe(true);
    dates.push(row.observedAt);
    for (const field of fields) {
      if (!row[field]) continue;
      const observation = row[field];
      expect(Object.keys(observation).sort()).toEqual(["observedAt", "source", "value"]);
      expect(observation.source).toBe("google_places");
      expect(observation.observedAt).toBe(row.observedAt);
      if (field === "regularOpeningHours") {
        expect(Array.isArray(observation.value.periods)).toBe(true);
        expect(Object.keys(observation.value).every(key => ["periods", "weekdayDescriptions"].includes(key))).toBe(true);
      } else expect(typeof observation.value).toBe("string");
    }
  }
  expect(pack.observedAt).toBe(dates.sort()[0]);
  expect(pack.summary.venues).toBe(ids.size);
  expect(pack.spend.reservedUsd).toBe(pack.spend.attemptedCalls * 2 / 100);
  expect(pack.spend.month).toMatch(/^\d{4}-\d{2}$/);
  expect(pack.spend.monthReservedUsd).toBe(pack.spend.monthAttemptedCalls * 2 / 100);
  expect(pack.spend.monthReservedUsd).toBeLessThanOrEqual(pack.spend.capUsd);
  expect(pack.spend.monthAttemptedCalls).toBeLessThanOrEqual(pack.spend.attemptedCalls);
  expect(pack.spend.capUsd).toBeLessThanOrEqual(85);
  expect(pack.spend.attemptedCalls).toBeGreaterThanOrEqual(ids.size);
  expect(pack.summary.errors).toBe(pack.errors.length);
});

it("dates google_places_content from the committed stamp of the pack, never the full pack", () => {
  const pack = read("data/places_enrichment.json");
  const dataset = read("data/freshness_registry.json").datasets.find((row: { id: string }) => row.id === "google_places_content");
  const opened: (string | null)[] = [];
  const resolution = resolveDatasetStamp(root, dataset, (dir, relPath) => {
    opened.push(relPath);
    return readFreshnessArtifact(dir, relPath);
  });
  expect(opened).toEqual(["data/places_enrichment_stamp.json"]);
  expect(read("data/places_enrichment_stamp.json")).toEqual(placesEnrichmentStamp(pack));
  expect(resolution.observedAt).toBe(pack.observedAt);
});
