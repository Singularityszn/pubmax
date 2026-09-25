import { describe, expect, it } from "vitest";

import {
  buildVenueIndexes,
  mergeDrinkUpdates,
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

  it("replaces a publisher drink row when its validated source URL changes", () => {
    const existing = {
      venueKey: "prospect|london",
      drinkName: "Diet Coke",
      category: "soft-drink",
      priceGbp: 3,
      observedAt: "2026-01-01T00:00:00.000Z",
      source: {
        label: "Greene King — official menu",
        url: "https://www.greeneking.co.uk/prospect/menu",
      },
    };
    const refreshed = {
      ...existing,
      priceGbp: 3.2,
      observedAt: "2026-09-22T00:00:00.000Z",
      source: {
        ...existing.source,
        url: "https://www.greeneking.co.uk/prospect/menu?canonical=1",
      },
    };

    expect(mergeDrinkUpdates([existing], [refreshed])).toEqual([refreshed]);
  });
});
