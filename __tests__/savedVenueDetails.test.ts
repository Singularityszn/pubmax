import { describe, expect, it } from "vitest";

import {
  SAVED_VENUE_DETAILS_MAX,
  readSavedVenueDetail,
  saveVenueDetail,
} from "@/lib/savedVenueDetails";

function memoryStorage(refuseOver = Infinity) {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > refuseOver) throw new DOMException("full", "QuotaExceededError");
      values.set(key, value);
    },
  };
}

describe("saved venue details", () => {
  it("reads requested and canonical ids from one copy and keeps aliases after reopening", () => {
    const storage = memoryStorage();
    const venue = { id: "venue-canonical", name: "The Alias Arms" };
    saveVenueDetail("venue-alias", venue, new Date("2026-11-10T20:00:00Z"), storage);
    expect(readSavedVenueDetail("venue-alias", storage)?.venue).toEqual(venue);
    expect(readSavedVenueDetail("venue-canonical", storage)?.venue).toEqual(venue);

    const updated = { ...venue, name: "The Updated Arms" };
    saveVenueDetail("venue-other-alias", updated, new Date("2026-11-11T20:00:00Z"), storage);
    saveVenueDetail("venue-canonical", updated, new Date("2026-11-12T20:00:00Z"), storage);
    for (const id of ["venue-alias", "venue-other-alias", "venue-canonical"]) {
      expect(readSavedVenueDetail(id, storage)).toEqual({
        venue: updated,
        savedAt: "2026-11-12T20:00:00.000Z",
      });
    }
    for (let index = 1; index < SAVED_VENUE_DETAILS_MAX; index += 1) {
      saveVenueDetail(`venue-${index}`, { id: `venue-${index}` }, new Date(), storage);
    }
    expect(readSavedVenueDetail("venue-alias", storage)?.venue).toEqual(updated);
    saveVenueDetail("venue-new", { id: "venue-new" }, new Date(), storage);
    for (const id of ["venue-alias", "venue-other-alias", "venue-canonical"]) {
      expect(readSavedVenueDetail(id, storage)).toBeNull();
    }
  });

  it("keeps the most recently opened pubs and drops the oldest past the cap", () => {
    const storage = memoryStorage();
    for (let index = 0; index <= SAVED_VENUE_DETAILS_MAX; index += 1) {
      saveVenueDetail(`venue-${index}`, { id: `venue-${index}` }, new Date(Date.UTC(2026, 10, 1, 0, index)), storage);
    }
    // Reopening an old pub moves it to the front instead of keeping two copies.
    saveVenueDetail("venue-1", { id: "venue-1", name: "Again" }, new Date("2026-11-12T21:00:00Z"), storage);

    expect(readSavedVenueDetail("venue-0", storage)).toBeNull();
    expect(readSavedVenueDetail("venue-1", storage)).toEqual({
      venue: { id: "venue-1", name: "Again" },
      savedAt: "2026-11-12T21:00:00.000Z",
    });
    saveVenueDetail("venue-new", { id: "venue-new" }, new Date(), storage);
    expect(readSavedVenueDetail("venue-2", storage)).toBeNull();
    expect(readSavedVenueDetail("venue-1", storage)).not.toBeNull();
  });

  it("drops older copies when the browser refuses the write, and never throws", () => {
    const filler = "x".repeat(2_000);
    const storage = memoryStorage(10 * 2_100);
    for (let index = 0; index < 12; index += 1) {
      expect(() =>
        saveVenueDetail(`venue-${index}`, { id: `venue-${index}`, filler }, new Date(), storage),
      ).not.toThrow();
    }
    expect(readSavedVenueDetail("venue-11", storage)).not.toBeNull();
    expect(readSavedVenueDetail("venue-0", storage)).toBeNull();
  });

  it("reads nothing from a damaged store", () => {
    const storage = memoryStorage();
    storage.setItem("pubmax:saved-venue-details:v1", "{not json");
    expect(readSavedVenueDetail("venue-1", storage)).toBeNull();
    storage.setItem(
      "pubmax:saved-venue-details:v1",
      JSON.stringify([{ id: "venue-1", savedAt: "not a date", venue: { id: "venue-1" } }]),
    );
    expect(readSavedVenueDetail("venue-1", storage)).toBeNull();
  });
});
