import { afterEach, describe, expect, it } from "vitest";

import { parseOverlayRow } from "@/lib/harvestFold";
import {
  __resetHarvestOverlayStore,
  harvestOverlayStore,
} from "@/lib/harvestOverlayStore";

const row = parseOverlayRow({
  osmId: "node/123",
  website: "https://redlion.example/",
  menuUrl: "https://redlion.example/menu",
  matchedLore: {
    text: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
    citations: ["https://history.example/red-lion-clapham"],
  },
  sources: ["https://redlion.example/"],
});

afterEach(() => {
  __resetHarvestOverlayStore();
});

describe("harvestOverlayStore", () => {
  it("upserts by OSM id and reads back through every salted venue id", async () => {
    const outcome = await harvestOverlayStore().upsertMany([row]);
    expect(outcome.written).toBe(1);
    expect(outcome.failed).toBeUndefined();

    for (const id of ["node/123", "n123", "venue-uk-n123", "venue-osm-n123"]) {
      const found = await harvestOverlayStore().getByVenueId(id);
      expect(found?.osmId).toBe("node/123");
      expect(found?.website).toBe("https://redlion.example/");
      expect(found?.matchedLore?.citations[0]).toBe(
        "https://history.example/red-lion-clapham",
      );
    }
  });

  it("treats a miss as unknown, never no-history, and ignores a name", async () => {
    await harvestOverlayStore().upsertMany([row]);
    expect(await harvestOverlayStore().getByVenueId("venue-7l4pei")).toBeNull();
    expect(await harvestOverlayStore().getByVenueId("The Red Lion")).toBeNull();
  });

  it("is idempotent: a second upsert of the same OSM id replaces the row", async () => {
    await harvestOverlayStore().upsertMany([row]);
    const updated = parseOverlayRow({
      osmId: "node/123",
      website: "https://redlion.example/new",
      menuUrl: null,
      matchedLore: null,
      sources: ["https://redlion.example/new"],
    });
    await harvestOverlayStore().upsertMany([updated]);
    const found = await harvestOverlayStore().getByVenueId("venue-uk-n123");
    expect(found?.website).toBe("https://redlion.example/new");
    expect(found?.matchedLore).toBeNull();
  });
});
