import { describe, expect, it } from "vitest";

import { buildCheapestHunt, huntCityPints, type HuntPint } from "@/lib/cheapestHunt";
import { tonightCheapestAnswer } from "@/lib/tonightAnswers";
import {
  tonightCheapPintCandidates,
  tonightCheapPintChain,
  tonightCheapPintChainLabel,
  tonightCheapPintHref,
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
      observedAt: null,
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

/**
 * ONE RULE FOR "CHEAPEST IN LONDON" (design plan step 0.2b, 2 Nov 2026).
 * Tonight said "Cheapest in London, J.J. Moon's, £2.09" while the front door
 * said £2.43: Tonight ranked each pub's raw figure, and the £2.09 row was never
 * on the pub's own page, so the hunt (lib/cheapestHunt.ts) holds it out. The
 * list now takes the hunt's London pints in the hunt's own order.
 */
describe("tonight cheap pints, the hunt's London list", () => {
  function huntPint(overrides: Partial<HuntPint> & Pick<HuntPint, "venueId" | "pubName" | "priceGbp">): HuntPint {
    return {
      cityId: "london",
      placeName: "London",
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/" },
      observedOn: "2026-10-02",
      standing: "listed",
      lane: "london-list",
      mapHref: `/map?sel=${overrides.venueId}` as HuntPint["mapHref"],
      ...overrides,
    };
  }

  const PINTS: HuntPint[] = [
    huntPint({ venueId: "venue-qall4d", pubName: "The Moon on the Hill", priceGbp: 2.43, observedOn: "2026-09-02" }),
    huntPint({ venueId: "venue-cbqtvi", pubName: "J.J. Moon's", priceGbp: 2.43 }),
    huntPint({ venueId: "venue-g5uud9", pubName: "J.J. Moon's", priceGbp: 2.43 }),
    huntPint({ venueId: "venue-19vregq", pubName: "Nags Head, Peckham", priceGbp: 2.9 }),
    huntPint({
      venueId: "venue-uk-w921298161",
      pubName: "The Artichoke",
      priceGbp: 4,
      lane: "uk-bundle",
      observedOn: "2026-09-21",
      mapHref: "/map?sel=venue-uk-w921298161&at=51.5,-0.1" as HuntPint["mapHref"],
    }),
  ];
  const LONDON_LIST = new Map([
    ["venue-cbqtvi", { id: "venue-cbqtvi", website: "", prices: [], primaryBorough: "Brent" }],
    ["venue-g5uud9", { id: "venue-g5uud9", website: "", prices: [], primaryBorough: "Hillingdon" }],
    ["venue-qall4d", { id: "venue-qall4d", website: "", prices: [], primaryBorough: "Sutton" }],
    ["venue-19vregq", { id: "venue-19vregq", website: "", prices: [], primaryBorough: "Southwark" }],
  ]);
  const SPOONS = new Set(["venue-cbqtvi", "venue-g5uud9", "venue-qall4d"]);

  const rows = tonightCheapPints(
    tonightCheapPintCandidates(huntCityPints(PINTS, "london"), LONDON_LIST, SPOONS),
  );

  it("keeps only hunt pints with a valid day and named publisher", () => {
    const candidates = tonightCheapPintCandidates([
      huntPint({ venueId: "valid", pubName: "Valid", priceGbp: 5 }),
      huntPint({ venueId: "bad-day", pubName: "Bad day", priceGbp: 3, observedOn: "2026-02-30" }),
      huntPint({ venueId: "no-publisher", pubName: "No publisher", priceGbp: 2, publisher: { label: "", url: "" } }),
    ], LONDON_LIST, SPOONS);
    expect(candidates.map((row) => row.id)).toEqual(["valid"]);
  });

  it("carries the hunt's selected serving and source through to the presentation row", () => {
    const selected = huntPint({ venueId: "valid", pubName: "Valid", priceGbp: 5 });
    const candidate = tonightCheapPintCandidates([{ ...selected, drinkLabel: "Selected lager", servingSize: "pint" }], LONDON_LIST, SPOONS);
    expect(tonightCheapPints(candidate)[0]).toMatchObject({
      drinkLabel: "Selected lager", servingSize: "pint",
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/" },
      observedAt: "2026-10-02T12:00:00.000Z",
    });
  });

  it("opens on the pub the front door's London row names", () => {
    const londonRow = buildCheapestHunt(PINTS).cities.find((city) => city.cityId === "london")?.pint;
    expect(rows[0]?.venueId).toBe(londonRow?.venueId);
    expect(tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: rows })).toMatchObject({
      venueId: londonRow?.venueId,
      priceGbp: londonRow?.priceGbp,
      basis: "city",
    });
  });

  it("keeps the hunt's order and one row per chain", () => {
    expect(rows.map((row) => [row.venueId, row.chain])).toEqual([
      ["venue-cbqtvi", "wetherspoon"],
      ["venue-19vregq", null],
      ["venue-uk-w921298161", null],
    ]);
  });

  it("takes the borough from our pub list, else the city the hunt placed the pub in", () => {
    expect(rows.map((row) => row.borough)).toEqual(["Brent", "Southwark", "London"]);
  });

  it("dates each row by the hunt's read day, at London midday", () => {
    expect(rows[0]?.observedAt).toBe("2026-10-02T12:00:00.000Z");
  });

  it("opens a base pub from its own point, through the hunt's own map link", () => {
    expect(tonightCheapPintHref(rows[2]!)).toBe("/map?sel=venue-uk-w921298161&at=51.5,-0.1");
    expect(tonightCheapPintHref({ venueId: "venue-a" })).toBe("/map?sel=venue-a");
    expect(
      tonightCheapestAnswer({ origin: null, patch: null, nearby: [], cityRows: [rows[2]!] })?.mapHref,
    ).toBe("/map?sel=venue-uk-w921298161&at=51.5,-0.1");
  });

  it("breaks a tie at one price by the freshest read before the name", () => {
    const tied = tonightCheapPints([
      { id: "venue-a", name: "The Alpha", primaryBorough: "Brent", cheapestPrice: 3, observedAt: "2026-09-01T12:00:00.000Z" },
      { id: "venue-b", name: "The Beta", primaryBorough: "Brent", cheapestPrice: 3, observedAt: "2026-10-01T12:00:00.000Z" },
    ]);
    expect(tied.map((row) => row.name)).toEqual(["The Beta", "The Alpha"]);
  });
});
