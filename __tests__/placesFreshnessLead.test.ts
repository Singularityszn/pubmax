// GOOGLE PLACES CONTENT GOES STALE TWO WEEKS BEFORE ITS HOURS LAPSE.
//
// Copied Places opening hours set open state and plan route evidence only
// inside PLACES_REFRESH_DAYS (30) of their own observedAt
// (lib/venuePlacesEnrichment.ts). Every row of both packs was copied on
// 2026-10-04, so on 2026-11-03 the hours of 4,269 venues drop out together.
// The registry dated the lane from the oldest copied row with a 720h budget,
// so it read stale at the very instant the hours lapsed, with no lead to run
// a paid refresh that has to fit a monthly spend cap.
//
// The budget is now the refresh window less a two-week lead, like
// famous_venues: the lane reads stale while every committed row's hours are
// still served.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PLACES_REFRESH_DAYS, PLACES_REFRESH_START_DAYS, placesOpeningHours, type PlacesEnrichmentRecord } from "@/lib/placesEnrichment";
import { evaluateFreshness } from "@/scripts/check_freshness.mjs";
import { readPlacesEnrichmentPacks } from "@/scripts/lib/placesEnrichmentStamp.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const HOUR_MS = 60 * 60 * 1000;
const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
const entry = registry.datasets.find((d: { id: string }) => d.id === "google_places_content");
const stamp = JSON.parse(readFileSync(join(ROOT, "data/places_enrichment_stamp.json"), "utf8")) as {
  observedAt: string;
};

async function status(now: Date): Promise<string> {
  const { results } = await evaluateFreshness({
    registry: { version: registry.version, datasets: [entry] },
    now,
    rootDir: ROOT,
  });
  return defined(results[0]).status;
}

describe("google_places_content freshness lead", () => {
  it("budgets the refresh start window, the moment a --refresh push may begin", () => {
    expect(entry.stalenessBudgetHours).toBe(PLACES_REFRESH_START_DAYS * 24);
    expect(PLACES_REFRESH_DAYS - PLACES_REFRESH_START_DAYS).toBe(14);
  });

  it("reads stale while every committed row's opening hours are still served", async () => {
    const oldest = Date.parse(stamp.observedAt);
    const budgetMs = defined(entry.stalenessBudgetHours) * HOUR_MS;
    expect(await status(new Date(oldest + budgetMs - HOUR_MS))).not.toBe("stale");

    const firstStale = new Date(oldest + budgetMs + HOUR_MS);
    expect(await status(firstStale)).toBe("stale");

    const rows = Object.values(readPlacesEnrichmentPacks(ROOT)).flatMap(
      (pack) => pack.venues as unknown as PlacesEnrichmentRecord[],
    );
    const withHours = rows.filter((row) => row.regularOpeningHours);
    expect(withHours.length).toBeGreaterThan(0);
    for (const row of withHours) {
      expect(placesOpeningHours(row, firstStale, PLACES_REFRESH_DAYS)).toBeDefined();
    }
  });
});
