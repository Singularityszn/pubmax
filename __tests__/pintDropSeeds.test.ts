import { describe, expect, it } from "vitest";

import { demoDropsFor, demoPintDrops } from "@/lib/pintDropSeeds";
import { listAllVisiblePintDrops, listVisiblePintDrops } from "@/lib/pintDrops";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import dataset from "../public/data/pint_prices_app_dataset.json";

const venues = groupVenuePrices(dataset as VenuePrice[]);
const venueById = new Map(venues.map((venue) => [venue.id, venue]));

describe("demo Pint Drop seeds", () => {
  it("seeds 8-12 drops, all provenance-tagged demo and visible", () => {
    expect(demoPintDrops.length).toBeGreaterThanOrEqual(8);
    expect(demoPintDrops.length).toBeLessThanOrEqual(12);
    for (const drop of demoPintDrops) {
      expect(drop.provenance).toBe("demo");
      expect(drop.status).toBe("visible");
    }
  });

  it("every seed venueId resolves to a real curated heritage venue in the dataset", () => {
    for (const drop of demoPintDrops) {
      const venue = venueById.get(drop.venueId);
      expect(venue, `seed ${drop.id} points at missing venue ${drop.venueId}`).toBeDefined();
      // These are the curated heritage pubs — each carries an editorial note.
      expect(venue!.curation.heritageNote, `${venue!.name} is not curated`).toBeTruthy();
    }
  });

  it("every seed carries the story layer: a note, a handle, and a sane price", () => {
    for (const drop of demoPintDrops) {
      expect(drop.passedDownNote.trim().length).toBeGreaterThan(0);
      expect(drop.passedDownNote.length).toBeLessThanOrEqual(500);
      expect(drop.handle.startsWith("@")).toBe(true);
      expect(drop.priceGbp).toBeGreaterThan(0);
      expect(drop.priceGbp).toBeLessThanOrEqual(20);
      expect(drop.id.startsWith("seed-")).toBe(true);
    }
    // Ids are unique (they key React lists and reports).
    expect(new Set(demoPintDrops.map((d) => d.id)).size).toBe(demoPintDrops.length);
  });

  it("seeds ride the single in-memory read path (no second render path)", () => {
    const all = listAllVisiblePintDrops();
    for (const drop of demoPintDrops) {
      expect(all.some((d) => d.id === drop.id)).toBe(true);
    }
    const first = demoPintDrops[0];
    expect(listVisiblePintDrops(first.venueId)).toContainEqual(first);
    expect(demoDropsFor(first.venueId)).toContainEqual(first);
    expect(demoDropsFor("venue-nope")).toEqual([]);
  });
});
