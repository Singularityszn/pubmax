import { writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import stationZones from "@/data/tfl_station_zones.json";
import placeNames from "@/lib/ask/placeNames.generated.json";
import { isKnownAskPlacePhrase, wordsOnly } from "@/lib/ask/placePhrases";
import { matchVenueNameWithinQuery } from "@/lib/ask/venueResolution";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import localityGazetteer from "@/public/data/london_localities.json";

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  writeFileSync: vi.fn(),
}));

describe("generated raw-name projection", () => {
  it("imports and generates the canonical projection without writing files", async () => {
    const write = vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error("Importing or calling the pure generator must not write files");
    });
    try {
      const { generateAskPlaceNames } = await import("@/scripts/gen_ask_place_names");
      expect(generateAskPlaceNames()).toEqual(placeNames);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockReset();
    }
  });

  it("matches the authoritative datasets without removing duplicates or changing order", () => {
    // This serialized data contract includes only names used by the two consumers.
    // An added field, missing row, reordered name or stale alias must fail equality.
    expect(placeNames).toEqual({
      stationNames: stationZones.stations.map((station) => station.name),
      localityNames: localityGazetteer.localities.map((locality) => locality.name),
      nightAreas: NIGHT_AREAS.map(({ name, aliases, transportAnchors }) => ({
        name,
        aliases,
        transportAnchors,
      })),
    });
  });
});

describe("shared Ask place vocabulary", () => {
  it.each([
    ["The Elephant & Castle", "the elephant and castle"],
    ["King’s Cross St. Pancras", "kings cross st pancras"],
    ["Harrow-on-the-Hill", "harrow on the hill"],
  ])("keeps punctuation and conjunction rules for %s", (label, normalized) => {
    expect(wordsOnly(label)).toBe(normalized);
    expect(isKnownAskPlacePhrase(label)).toBe(true);
  });

  it.each([
    ["The Elephant and Castle", "Find pubs near Elephant & Castle"],
    ["The Hill", "Find pubs near Harrow on the Hill"],
    ["The Bridge", "Find pubs near London Bridge"],
  ])("does not select %s from a place name", (name, query) => {
    expect(matchVenueNameWithinQuery([{ id: "same-word-pub", name, area: "Soho" }], query)).toBeNull();
  });

  it("still resolves an explicit multiword venue outside the place name", () => {
    const venue = { id: "crown-sceptre", name: "The Crown & Sceptre", area: "Fitzrovia" };
    expect(matchVenueNameWithinQuery([venue], "The Crown and Sceptre near London Bridge"))
      .toEqual(venue);
  });
});
