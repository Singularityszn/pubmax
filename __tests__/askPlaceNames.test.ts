import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import stationZones from "@/data/tfl_station_zones.json";
import placeNames from "@/lib/ask/placeNames.generated.json";
import { isKnownAskPlacePhrase, PLACE_PHRASES, wordsOnly } from "@/lib/ask/placePhrases";
import { matchVenueNameWithinQuery } from "@/lib/ask/venueResolution";
import { defaultKnownAreas } from "@/lib/concierge/intentPolicy";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import localityGazetteer from "@/public/data/london_localities.json";

describe("generated raw-name projection", () => {
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
  // Ordered public-output receipts from 0e0266dc, before the data projection.
  it("preserves all 773 phrase arrays and all 82 known-area labels in order", () => {
    expect(PLACE_PHRASES).toHaveLength(773);
    expect(createHash("sha256").update(JSON.stringify(PLACE_PHRASES)).digest("hex"))
      .toBe("614e1acdc5fd4aa3f6db617665d2ea82b3f121394f54455a10200b424852e4ed");
    expect(defaultKnownAreas()).toHaveLength(82);
    expect(createHash("sha256").update(JSON.stringify(defaultKnownAreas())).digest("hex"))
      .toBe("10558b05be9d35cf174ed7266fa903a565709758828f7bc2f180a26e9420ae1f");
  });

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
    expect(matchVenueNameWithinQuery([{ id: "same-word-pub", name }], query)).toBeNull();
  });

  it("still resolves an explicit multiword venue outside the place name", () => {
    const venue = { id: "crown-sceptre", name: "The Crown & Sceptre" };
    expect(matchVenueNameWithinQuery([venue], "The Crown and Sceptre near London Bridge"))
      .toEqual(venue);
  });
});
