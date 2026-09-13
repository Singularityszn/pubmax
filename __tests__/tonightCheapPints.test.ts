import { describe, expect, it } from "vitest";

import {
  tonightCheapPintChain,
  tonightCheapPintChainLabel,
  tonightCheapPints,
  TONIGHT_CHEAP_PINTS_LIMIT,
} from "@/lib/tonightCheapPints";

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
      chain: null,
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

/**
 * One chain, one row (site audit D17, 13 Sep 2026). The Spoons import set
 * £1.99 on a dozen Wetherspoon pubs, so the list read four Wetherspoons and
 * no other pub. A chain prices one menu across every branch: its cheapest
 * branch answers for the chain, and the other rows go to other pubs.
 */
describe("tonight cheap pints, one row per chain", () => {
  const SPOONS_NIGHT = [
    { id: "jdw-1", name: "The Fox on the Hill", primaryBorough: "Southwark", cheapestPrice: 1.99, chain: "wetherspoon" as const },
    { id: "jdw-2", name: "The George", primaryBorough: "Croydon", cheapestPrice: 1.99, chain: "wetherspoon" as const },
    { id: "jdw-3", name: "The Kentish Drovers", primaryBorough: "Southwark", cheapestPrice: 1.99, chain: "wetherspoon" as const },
    { id: "gk-1", name: "The Greene One", primaryBorough: "Camden", cheapestPrice: 3.1, chain: "greene-king" as const },
    { id: "gk-2", name: "The Greene Two", primaryBorough: "Camden", cheapestPrice: 3.2, chain: "greene-king" as const },
    { id: "ind-1", name: "The Free House", primaryBorough: "Hackney", cheapestPrice: 3.5, chain: null },
    { id: "ind-2", name: "The Local", primaryBorough: "Lambeth", cheapestPrice: 3.6 },
  ];

  it("keeps the cheapest branch of each chain and gives the other rows to other pubs", () => {
    expect(tonightCheapPints(SPOONS_NIGHT).map((row) => row.venueId)).toEqual([
      "jdw-1",
      "gk-1",
      "ind-1",
      "ind-2",
    ]);
  });

  it("names the chain on its row, and a pub no chain runs carries none", () => {
    const rows = tonightCheapPints(SPOONS_NIGHT);
    expect(rows.map((row) => row.chain)).toEqual(["wetherspoon", "greene-king", null, null]);
    expect(tonightCheapPintChainLabel("wetherspoon")).toBe("Wetherspoon");
    expect(tonightCheapPintChainLabel("greene-king")).toBe("Greene King");
  });

  it("never caps pubs no chain runs", () => {
    const independents = Array.from({ length: 6 }, (_, index) => ({
      id: `ind-${index}`,
      name: `Pub ${index}`,
      primaryBorough: "Southwark",
      cheapestPrice: 2,
      chain: null,
    }));
    expect(tonightCheapPints(independents)).toHaveLength(TONIGHT_CHEAP_PINTS_LIMIT);
  });
});

/**
 * Which chain runs a pub. Read off what a source says about the PUB, never a
 * guess from a name that merely sounds like a chain: the first-party
 * Wetherspoon directory join, the pub's own website host, or the listing that
 * published the price naming the operator.
 */
describe("tonight cheap pint chain", () => {
  const NONE: ReadonlySet<string> = new Set();

  function venue(
    overrides: Partial<{ id: string; website: string; prices: Array<{ pub_name: string; pub_url: string; website: string }> }> = {},
  ) {
    return {
      id: "venue-x",
      website: "",
      prices: [{ pub_name: "The Local", pub_url: "https://www.pint-prices.com/pub/1 High St/The Local", website: "" }],
      ...overrides,
    };
  }

  it("joins a pub the first-party Wetherspoon directory matched", () => {
    expect(tonightCheapPintChain(venue(), new Set(["venue-x"]))).toBe("wetherspoon");
  });

  it("reads the operator off the pub's own website host", () => {
    expect(tonightCheapPintChain(venue({ website: "https://www.jdwetherspoon.com/pubs/the-george/" }), NONE)).toBe(
      "wetherspoon",
    );
    expect(
      tonightCheapPintChain(
        venue({ prices: [{ pub_name: "The Greene", pub_url: "", website: "https://www.greeneking.co.uk/pubs/london/the-greene/" }] }),
        NONE,
      ),
    ).toBe("greene-king");
  });

  it("reads the operator the price listing named", () => {
    expect(
      tonightCheapPintChain(
        venue({
          prices: [
            { pub_name: "The George", pub_url: "https://www.pint-prices.com/pub/17 George St/The George", website: "" },
            {
              pub_name: "The George",
              pub_url: "https://www.pint-prices.com/pub/17-21%20George%20St/The%20George%20-%20JD%20Wetherspoon",
              website: "",
            },
          ],
        }),
        NONE,
      ),
    ).toBe("wetherspoon");
    expect(
      tonightCheapPintChain(
        venue({ prices: [{ pub_name: "The Pennsylvanian (JD Wetherspoons)", pub_url: "", website: "" }] }),
        NONE,
      ),
    ).toBe("wetherspoon");
  });

  it("answers null for a pub no source ties to a chain", () => {
    expect(tonightCheapPintChain(venue(), NONE)).toBeNull();
    // A name is not a publisher: "Moon" and "King" are words, not operators.
    expect(
      tonightCheapPintChain(
        venue({ prices: [{ pub_name: "The Moon and Greene King's Head", pub_url: "", website: "https://example.com" }] }),
        NONE,
      ),
    ).toBeNull();
  });
});
