import { describe, expect, it } from "vitest";

import {
  buildVenueIndexes,
  resolveVenueKeyFromHints,
  resolveVenueKeyFromPubName,
} from "@/scripts/lib/venueMatch.mjs";

const DUPLICATE_PUBS = [
  {
    pub_name: "King's Head",
    address: "1 High Street, London",
    latitude: 51.51,
    longitude: -0.12,
  },
  {
    pub_name: "King's Head",
    address: "2 High Street, London",
    latitude: 51.52,
    longitude: -0.13,
  },
];

describe("harvest venue matching", () => {
  it("does not choose the first venue when an exact name is ambiguous", () => {
    const indexes = buildVenueIndexes(DUPLICATE_PUBS);
    expect(resolveVenueKeyFromPubName("King's Head", indexes)).toBeNull();
  });

  it("does not choose the first venue when best hint score is tied", () => {
    const indexes = buildVenueIndexes(DUPLICATE_PUBS);
    expect(resolveVenueKeyFromHints(["kings", "head"], indexes)).toBeNull();
  });
});
