import { promises as fs } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseOverlayRow } from "@/lib/harvestFold";
import { __resetHarvestOverlayStore, harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { lookupVenueDetail, resetVenueDetailCachesForTests } from "@/lib/venueDetailIndex";
import { lookupCanonicalVenueWithOsm } from "@/lib/venueIndexOsm";
import { venueOsmIds } from "@/lib/venueIndex";

vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase")>()),
  isSupabaseConfigured: () => false,
}));
vi.mock("@/lib/venueMenuEnrichment", () => ({
  enrichVenueForDetail: async (venue: import("@/lib/venues").Venue) => ({
    ...venue,
    website: "",
    menuUrl: undefined,
  }),
}));

const VENUE_ID = "venue-16pnwmm";
let osmId = "";

beforeAll(async () => {
  const result = await lookupCanonicalVenueWithOsm(VENUE_ID);
  expect(result.status).toBe("found");
  if (result.status === "found") osmId = venueOsmIds(result.venue)[0] ?? "";
  expect(osmId).not.toBe("");
});

beforeEach(async () => {
  resetVenueDetailCachesForTests();
  __resetHarvestOverlayStore();
  await harvestOverlayStore().upsertMany([parseOverlayRow({
    osmId,
    website: "https://detail-overlay.example/",
    menuUrl: "https://detail-overlay.example/menu",
    matchedLore: null,
    sources: ["https://detail-overlay.example/"],
  })]);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetVenueDetailCachesForTests();
  __resetHarvestOverlayStore();
});

describe("optional venue detail harvest overlay", () => {
  it.each(["skip-first", "full-first"])("keeps an enriched base cache in %s order", async (order) => {
    const readFile = vi.spyOn(fs, "readFile");
    const overlayRead = vi.spyOn(harvestOverlayStore(), "getByVenueId");
    const osmReads = () => readFile.mock.calls.filter(([file]) => String(file).endsWith("uk_osm_pubs.json")).length;
    const readBase = () => lookupVenueDetail(VENUE_ID, { includeHarvestOverlay: false });
    const readFull = () => lookupVenueDetail(VENUE_ID);

    if (order === "skip-first") {
      const base = await readBase();
      expect(base.status).toBe("found");
      if (base.status === "found") expect(base.venue.website).toBe("");
      expect(osmReads()).toBe(0);
      expect(overlayRead).not.toHaveBeenCalled();
    }

    const full = await readFull();
    expect(full.status).toBe("found");
    if (full.status === "found") {
      expect(full.venue.website).toBe("https://detail-overlay.example/");
      expect(full.venue.menuUrl).toBe("https://detail-overlay.example/menu");
    }
    expect(osmReads()).toBeGreaterThan(0);
    expect(overlayRead).toHaveBeenCalledWith(osmId);
    const readsBeforeSkip = overlayRead.mock.calls.length;
    const osmBeforeSkip = osmReads();

    const base = await readBase();
    expect(base.status).toBe("found");
    if (base.status === "found") {
      expect(base.venue.website).toBe("");
      expect(base.venue.menuUrl).toBeUndefined();
      if (full.status === "found") expect(base.venue.prices).toEqual(full.venue.prices);
    }
    expect(overlayRead).toHaveBeenCalledTimes(readsBeforeSkip);
    expect(osmReads()).toBe(osmBeforeSkip);
  });
});
