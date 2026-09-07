import { describe, expect, it } from "vitest";

import { tonightCheapPints, TONIGHT_CHEAP_PINTS_LIMIT } from "@/lib/tonightCheapPints";

/**
 * What a quiet night answers with.
 *
 * No row here says a pub is quiet: the captain's F02 ruling settles that a
 * per-venue quiet reading does not exist in this product. A row says what it
 * can prove, which is a listed price at a named pub.
 */

const VENUES = [
  { id: "venue-a", name: "The Low Bell", primaryBorough: "Southwark", cheapestPrice: 4.2 },
  { id: "venue-b", name: "The High Horse", primaryBorough: "Camden", cheapestPrice: 7.4 },
  { id: "venue-c", name: "The Same Price", primaryBorough: "Hackney", cheapestPrice: 4.2 },
  { id: "venue-d", name: "The Unpriced", primaryBorough: "Brent", cheapestPrice: null },
  { id: "venue-e", name: "The Free One", primaryBorough: "Ealing", cheapestPrice: 0 },
];

describe("tonight cheap pints", () => {
  it("orders cheapest first, then by name", () => {
    expect(tonightCheapPints(VENUES).map((row) => row.name)).toEqual([
      "The Low Bell",
      "The Same Price",
      "The High Horse",
    ]);
  });

  it("drops a pub with no listed figure", () => {
    const names = tonightCheapPints(VENUES).map((row) => row.name);
    expect(names).not.toContain("The Unpriced");
    expect(names).not.toContain("The Free One");
  });

  it("carries the borough and the figure a row is about", () => {
    const [first] = tonightCheapPints(VENUES);
    expect(first).toEqual({
      venueId: "venue-a",
      name: "The Low Bell",
      borough: "Southwark",
      priceGbp: 4.2,
    });
  });

  it("stops at its own limit", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `venue-${index}`,
      name: `Pub ${index}`,
      primaryBorough: "Southwark",
      cheapestPrice: 4 + index / 10,
    }));
    expect(tonightCheapPints(many)).toHaveLength(TONIGHT_CHEAP_PINTS_LIMIT);
    expect(tonightCheapPints(many, 2)).toHaveLength(2);
  });

  it("answers nothing when nothing is priced", () => {
    expect(tonightCheapPints([])).toEqual([]);
  });
});
