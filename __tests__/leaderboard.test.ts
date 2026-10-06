import { describe, it, expect } from "vitest";

import {
  cheapestPints,
  cheapestByArea,
  leaderboardAdmitsStanding,
  leaderboardPubKey,
  leaderboardStandingFor,
  venueArea,
  UNKNOWN_AREA,
} from "@/lib/leaderboard";
import { isoDate, PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import { trustPillLabel } from "@/lib/trustPill";
import type { Venue } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

// The ranking helpers read id/name/cheapestPrice/cheapestPint/primaryBorough/
// visibleBoroughs and, since the board began wearing its trust label, the
// venue's own price rows: the publisher on a row is what earns the listing the
// board claims. A fixture therefore ships one publisher-bearing row by default,
// which is what every row of the bundled dataset carries; pass `prices: []` to
// build a venue nobody published.
function v(
  over: Partial<Venue> & { id: string; name: string; cheapestPrice: number | null },
): Venue {
  const prices =
    over.prices ??
    (typeof over.cheapestPrice === "number"
      ? [
          {
            app_price_id: `${over.id}-1`,
            pint_name: over.cheapestPint ?? "",
            price_gbp: over.cheapestPrice,
            pub_url: `https://www.pint-prices.com/pub/${over.id}`,
            scraped_at_values: PINT_DATASET_OBSERVED_AT.toISOString(),
          },
        ]
      : []);
  return {
    primaryBorough: "",
    visibleBoroughs: [],
    cheapestPint: "",
    ...over,
    prices,
  } as Venue;
}

describe("cheapestPints", () => {
  it("sorts ascending, drops null-priced venues, and respects the limit", () => {
    const venues = [
      v({ id: "a", name: "A", cheapestPrice: 6 }),
      v({ id: "b", name: "B", cheapestPrice: null }),
      v({ id: "c", name: "C", cheapestPrice: 4 }),
      v({ id: "d", name: "D", cheapestPrice: 5 }),
    ];
    const top2 = cheapestPints(venues, 2);
    expect(top2.map((e) => e.venue.id)).toEqual(["c", "d"]);
    expect(top2.map((e) => e.rank)).toEqual([1, 2]);
    // the null-priced venue is never ranked
    expect(cheapestPints(venues, 10).some((e) => e.venue.id === "b")).toBe(false);
  });

  it("breaks price ties on name deterministically", () => {
    const venues = [
      v({ id: "z", name: "Zebra", cheapestPrice: 5 }),
      v({ id: "a", name: "Anchor", cheapestPrice: 5 }),
    ];
    expect(cheapestPints(venues).map((e) => e.venue.name)).toEqual(["Anchor", "Zebra"]);
  });
});

describe("cheapestByArea", () => {
  it("returns the single cheapest venue per area, cheapest area first", () => {
    const venues = [
      v({ id: "1", name: "Soho Cheap", cheapestPrice: 4, primaryBorough: "Westminster" }),
      v({ id: "2", name: "Soho Pricey", cheapestPrice: 7, primaryBorough: "Westminster" }),
      v({ id: "3", name: "Hackney One", cheapestPrice: 5, primaryBorough: "Hackney" }),
    ];
    const result = cheapestByArea(venues);
    expect(result).toHaveLength(2);
    expect(result.find((e) => e.area === "Westminster")?.venue.id).toBe("1");
    expect(result.map((e) => e.area)).toEqual(["Westminster", "Hackney"]);
  });

  it("falls back to UNKNOWN_AREA when a venue has no borough", () => {
    const venues = [v({ id: "x", name: "Nowhere", cheapestPrice: 4 })];
    expect(venueArea(defined(venues[0]))).toBe(UNKNOWN_AREA);
    expect(defined(cheapestByArea(venues)[0]).area).toBe(UNKNOWN_AREA);
  });
});

// The Cheap Pint Leaderboard the captain read on 6 Sep 2026, in the shape the
// shipped dataset really produced. Ten ranked rows, six of them at £1.99, five
// of those the same drink, and one Wandsworth pub holding two rows under two
// spellings of its own name.
const OFFENDING_BOARD: ReadonlyArray<{
  id: string;
  name: string;
  cheapestPrice: number;
  cheapestPint: string;
  primaryBorough: string;
}> = [
  { id: "venue-gdlj1b", name: "The Fox on the Hill", cheapestPrice: 1.99, cheapestPint: "BUD LIGHT", primaryBorough: "Southwark" },
  { id: "venue-1e6ogfb", name: "The George", cheapestPrice: 1.99, cheapestPint: "BUD LIGHT", primaryBorough: "Croydon" },
  { id: "venue-1fabngq", name: "The Kentish Drovers", cheapestPrice: 1.99, cheapestPint: "Bud Light", primaryBorough: "Southwark" },
  { id: "venue-12g95oo", name: "The Moon Under Water", cheapestPrice: 1.99, cheapestPint: "BUD LIGHT", primaryBorough: "Enfield" },
  { id: "venue-14t4gxt", name: "The Pennsylvanian (JD Wetherspoons)", cheapestPrice: 1.99, cheapestPint: "Worthington\u2019s Creamflow Ale", primaryBorough: "Hillingdon" },
  { id: "venue-1dyrfr0", name: "The Rochester Castle", cheapestPrice: 1.99, cheapestPint: "BUD LIGHT", primaryBorough: "Hackney" },
  { id: "venue-11mu12n", name: "J.J. Moons", cheapestPrice: 2.09, cheapestPint: "Jaipur", primaryBorough: "Wandsworth" },
  { id: "venue-10paqy", name: "The Millers Well", cheapestPrice: 2.39, cheapestPint: "Carlsberg", primaryBorough: "Newham" },
  { id: "venue-o98nz5", name: "J.J. Moon\u2019s - JD Wetherspoon", cheapestPrice: 2.43, cheapestPint: "Bud Light", primaryBorough: "Wandsworth" },
  { id: "venue-g5uud9", name: "J.J. Moon\u2019s - JD Wetherspoon", cheapestPrice: 2.43, cheapestPint: "Bud Light", primaryBorough: "Hillingdon" },
];

describe("the Cheap Pint Leaderboard says one thing per row", () => {
  const board = () => cheapestPints(OFFENDING_BOARD.map((row) => v(row)), 10);

  it("prints one row for a price several pubs publish for the same drink", () => {
    const rows = board();
    const budLightAt199 = rows.filter(
      (entry) => entry.venue.cheapestPrice === 1.99 && /bud light/i.test(entry.venue.cheapestPint),
    );
    expect(budLightAt199).toHaveLength(1);
    // The cheapest pub still leads, and the tie is broken by name as before.
    expect(defined(rows[0]).venue.name).toBe("The Fox on the Hill");
  });

  it("keeps a different drink at the same price", () => {
    // £1.99 Worthington's is one pub's own figure, not the list five pubs share.
    expect(board().map((entry) => entry.venue.id)).toContain("venue-14t4gxt");
  });

  it("prints one row per pub, however the dataset spells it", () => {
    const rows = board();
    const wandsworth = rows.filter(
      (entry) => /moon/i.test(entry.venue.name) && entry.area === "Wandsworth",
    );
    expect(wandsworth).toHaveLength(1);
    expect(leaderboardPubKey(v(defined(OFFENDING_BOARD[6])))).toBe(
      leaderboardPubKey(v(defined(OFFENDING_BOARD[8]))),
    );
  });

  it("keeps two pubs of one name in two different areas apart", () => {
    expect(leaderboardPubKey(v(defined(OFFENDING_BOARD[8])))).not.toBe(
      leaderboardPubKey(v(defined(OFFENDING_BOARD[9]))),
    );
  });

  it("ranks contiguously and never repeats a pub or a price list", () => {
    const rows = board();
    expect(rows.map((entry) => entry.rank)).toEqual(
      Array.from({ length: rows.length }, (_, index) => index + 1),
    );
    const pubs = rows.map((entry) => leaderboardPubKey(entry.venue));
    expect(new Set(pubs).size).toBe(pubs.length);
  });

  it("leaves a figure with no drink beside it to rank on its own", () => {
    // A bare price proves no list, so two unnamed £5 pints both keep a row.
    const rows = cheapestPints([
      v({ id: "a", name: "Anchor", cheapestPrice: 5, primaryBorough: "Camden" }),
      v({ id: "z", name: "Zebra", cheapestPrice: 5, primaryBorough: "Camden" }),
    ]);
    expect(rows.map((entry) => entry.venue.id)).toEqual(["a", "z"]);
  });
});


describe("every row wears its trust label", () => {
  // Captain 6 Sep 2026, ruling on the board's honesty: it keeps its listed
  // rows and each says out loud that a listing is all it is.
  const COLLECTED = Date.parse(`${isoDate(PINT_DATASET_OBSERVED_AT)}T12:00:00.000Z`);
  const listedRow = v({
    id: "venue-gdlj1b",
    name: "The Fox on the Hill",
    cheapestPrice: 1.99,
    cheapestPint: "BUD LIGHT",
    primaryBorough: "Southwark",
  });

  it("reads the same standing the landing answer card reads", () => {
    expect(leaderboardStandingFor(listedRow as never, COLLECTED)).toBe("listed");
    expect(defined(cheapestPints([listedRow], 10, COLLECTED)[0]).standing).toBe("listed");
    expect(trustPillLabel("listed")).toBe("Listed");
  });

  it("refuses a row that cannot earn a listing", () => {
    // No publisher on any of its rows, so nothing published this figure and the
    // board would have to print "No price yet" beside a price it is showing.
    const unpublished = v({
      id: "venue-nopub",
      name: "The Unlisted",
      cheapestPrice: 1.5,
      cheapestPint: "Lager",
      primaryBorough: "Camden",
      prices: [
        { app_price_id: "venue-nopub-1", pint_name: "Lager", price_gbp: 1.5 },
      ] as never,
    });
    expect(leaderboardStandingFor(unpublished as never, COLLECTED)).toBe("none");
    expect(leaderboardAdmitsStanding("none")).toBe(false);
    const rows = cheapestPints([unpublished, listedRow], 10, COLLECTED);
    expect(rows.map((entry) => entry.venue.id)).toEqual(["venue-gdlj1b"]);
  });

  it("ages a listing out rather than claiming it for ever", () => {
    // LISTED_MAX_AGE_DAYS is 365, so two years after collection the same row
    // stands for nothing and leaves the board with its claim.
    const twoYearsOn = COLLECTED + 730 * 24 * 60 * 60 * 1000;
    expect(leaderboardStandingFor(listedRow as never, twoYearsOn)).toBe("none");
    expect(cheapestPints([listedRow], 10, twoYearsOn)).toEqual([]);
  });

  it("holds a refused row out without spending the pub key of another", () => {
    // A refused row must not take a second pub of the same price list with it.
    const unpublishedCheaper = v({
      id: "venue-nopub2",
      name: "The Unlisted Two",
      cheapestPrice: 1.99,
      cheapestPint: "BUD LIGHT",
      primaryBorough: "Croydon",
      prices: [
        { app_price_id: "venue-nopub2-1", pint_name: "BUD LIGHT", price_gbp: 1.99 },
      ] as never,
    });
    const rows = cheapestPints([unpublishedCheaper, listedRow], 10, COLLECTED);
    expect(rows.map((entry) => entry.venue.id)).toEqual(["venue-gdlj1b"]);
    expect(defined(rows[0]).standing).toBe("listed");
  });
});
