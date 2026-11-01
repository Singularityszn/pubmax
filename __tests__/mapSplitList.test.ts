import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { VenueSignal } from "@/components/map/canvas/types";
import type { MapLensPrice } from "@/lib/mapExperienceLens";
import {
  MAP_SPLIT_LIST_NO_PRICE,
  buildMapSplitListGroups,
  mapSplitListDay,
  mapSplitListFacts,
  mapSplitListMembershipKey,
  mapSplitListPrice,
  mapSplitListVenues,
  pageMapSplitListGroups,
  sortMapSplitListRows,
  type MapSplitListInput,
} from "@/lib/mapSplitList";
import { floatingMapListOpen } from "@/lib/mapSplitListFocus";
import { projectedItemIdsInViewport } from "@/lib/mapVenueList";
import { peekPriceChip } from "@/lib/pubMap";
import { desktopSelectCameraOffset, restingRightDrawerLeft } from "@/lib/sheetSnap";
import { venuePriceLane } from "@/lib/venuePriceLane";
import type { UkBasePub } from "@/lib/ukBasePubs";
import type { Venue } from "@/lib/venues";

// The list beside the map (components/map/MapSplitList.tsx) and its pure half.
// A fixed clock, because every caption here is dated and a listing ages.
const NOW = new Date("2026-11-01T12:00:00.000Z");
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const CENTRE: [number, number] = [-0.13, 51.513];

function venue(overrides: Partial<Venue> & { id: string }): Venue {
  return {
    name: `Pub ${overrides.id}`,
    latitude: 51.513,
    longitude: -0.13,
    cheapestPrice: null,
    prices: [],
    primaryBorough: "Westminster",
    amenities: {},
    ...overrides,
  } as Venue;
}

/** A price row the venue detail carries once the sheet has read it. */
function listedRow(priceGbp: number, readAt: string) {
  return {
    price_gbp: priceGbp,
    pint_name: "Lager",
    pub_url: "https://www.greeneking.co.uk/pubs/greater-london/the-test",
    scraped_at_values: readAt,
  };
}

function input(overrides: Partial<MapSplitListInput>): MapSplitListInput {
  return {
    venues: [],
    basePubs: [],
    restaurants: [],
    dropSignals: new Map(),
    viewportCenter: CENTRE,
    reader: null,
    sort: "cheapest",
    ...overrides,
  };
}

describe("which venues the list shows", () => {
  it("lists only the venues the map projects inside its own view", () => {
    // The canvas publishes membership through projectedItemIdsInViewport, and
    // PubMap hands the list the venues it named: a pin past the canvas edge is
    // not "in view" even when the bounding box would include it.
    const all = [
      venue({ id: "in-view", longitude: -0.13 }),
      venue({ id: "off-canvas", longitude: -0.2 }),
    ];
    const screen: Record<string, { x: number; y: number }> = {
      "in-view": { x: 300, y: 200 },
      "off-canvas": { x: -40, y: 200 },
    };
    const ids = new Set(
      projectedItemIdsInViewport(all, (item) => screen[item.id]!, { width: 800, height: 600 }),
    );
    const visible = all.filter((item) => ids.has(item.id));
    const groups = buildMapSplitListGroups(input({ venues: visible }));
    expect(groups.venues.map((row) => row.id)).toEqual(["in-view"]);
    expect(groups.total).toBe(1);
  });

  it("follows the live view while Search as I move the map is on", () => {
    const visible = [venue({ id: "a" })];
    const filtered = [venue({ id: "a" }), venue({ id: "b" })];
    expect(
      mapSplitListVenues({ followMap: true, visible, filtered, heldIds: new Set(["b"]) }),
    ).toBe(visible);
  });

  it("keeps the view it last searched while the toggle is off, through the live filters", () => {
    const filtered = [venue({ id: "a" }), venue({ id: "c" })];
    const shown = mapSplitListVenues({
      followMap: false,
      visible: [venue({ id: "z" })],
      filtered,
      // "b" was in the searched view but a filter has since taken it off the map.
      heldIds: new Set(["a", "b"]),
    });
    expect(shown.map((item) => item.id)).toEqual(["a"]);
  });

  it("names a membership by its ids alone, whatever order they arrive in", () => {
    const key = mapSplitListMembershipKey({ venueIds: ["b", "a"], basePubIds: [], restaurantIds: ["r"] });
    expect(key).toBe(mapSplitListMembershipKey({ venueIds: ["a", "b"], basePubIds: [], restaurantIds: ["r"] }));
    expect(key).not.toBe(mapSplitListMembershipKey({ venueIds: ["a"], basePubIds: [], restaurantIds: ["r"] }));
  });

  it("never opens the floating List view over the map once the list sits beside it", () => {
    expect(floatingMapListOpen(true, false)).toBe(true);
    expect(floatingMapListOpen(true, true)).toBe(false);
    expect(floatingMapListOpen(false, false)).toBe(false);
  });
});

describe("a row's price is the venue sheet's own reading", () => {
  it("prints the peek chip's figure and caption for a pub the sheet has read", () => {
    const pub = venue({
      id: "venue-listed",
      cheapestPrice: 5.2,
      prices: [listedRow(5.2, "2026-10-12T10:00:00.000Z")] as Venue["prices"],
    });
    const chip = peekPriceChip(venuePriceLane(pub, null, null), {});
    const price = mapSplitListPrice(pub, undefined);
    expect(price.figure).toBe(chip?.figure);
    expect(price.caption).toBe(chip?.caption);
    expect(price.caption).toBe("Listed · collected 12 Oct");
    // The caption already says the day, so it is not said twice.
    expect(price.day).toBeNull();
    expect(price.observed).toBe(true);
    expect(price.rankGbp).toBe(5.2);
  });

  it("words a slim pin's figure by the publisher and read day the index holds, never 'publisher not recorded'", () => {
    const pub = venue({
      id: "venue-slim",
      cheapestPrice: 4.85,
      priceSource: "greeneking.co.uk",
      priceObservedAt: "2026-10-20",
    });
    const price = mapSplitListPrice(pub, undefined);
    expect(price.figure).toBe("£4.85");
    expect(price.caption).toBe("On record · greeneking.co.uk · read 20 Oct");
    expect(price.caption).not.toMatch(/not recorded/);
    expect(price.aging).toBe(false);
    expect(price.rankGbp).toBe(4.85);
  });

  it("says a slim pin with no named publisher is unrecorded, and ages a figure with no read day", () => {
    const price = mapSplitListPrice(venue({ id: "venue-bare", cheapestPrice: 5 }), undefined);
    expect(price.caption).toBe("On record · Publisher not recorded");
    expect(price.aging).toBe(true);
  });

  it("dates a drinker's report that waits for a second drinker, and keeps it off the cheapest lead", () => {
    const signal = {
      hasPintDrops: true,
      latestContributorPrice: null,
      provisionalContributorPrice: 3.9,
      provisionalContributorAt: Date.parse("2026-10-30T20:00:00.000Z"),
      pintTrust: "logged-once",
    } as VenueSignal;
    const price = mapSplitListPrice(venue({ id: "venue-drop", cheapestPrice: 5.5 }), signal);
    expect(price.figure).toBe("£3.90");
    expect(price.caption).toBe("Logged once, needs a second drinker");
    expect(price.day).toBe("30 Oct");
    expect(price.trust).toBe("logged-once");
    expect(price.rankGbp).toBeNull();
  });

  it("says when the map holds no price at all", () => {
    const price = mapSplitListPrice(venue({ id: "venue-none" }), undefined);
    expect(price).toMatchObject({ figure: null, caption: MAP_SPLIT_LIST_NO_PRICE, rankGbp: null });
  });

  it("prints the drink lens's price, or the lens's own unknown line", () => {
    const lensPrice: MapLensPrice = {
      venueId: "venue-lens",
      category: "wine",
      categoryLabel: "House wine",
      priceGbp: 6.4,
      observedAt: "2026-10-28",
      source: "community",
    };
    const lens = { prices: new Map([["venue-lens", lensPrice]]), noun: "Wine", status: "ready" as const };
    const priced = mapSplitListPrice(venue({ id: "venue-lens", cheapestPrice: 5 }), undefined, lens);
    expect(priced).toMatchObject({ figure: "£6.40", caption: "House wine", day: "28 Oct", bandGbp: null, rankGbp: 6.4 });
    const unknown = mapSplitListPrice(venue({ id: "venue-other", cheapestPrice: 5 }), undefined, lens);
    expect(unknown.figure).toBeNull();
    expect(unknown.caption).toBe("no wine price logged");
  });

  it("formats a day the way every trust caption does", () => {
    expect(mapSplitListDay("2026-10-12")).toBe("12 Oct");
    expect(mapSplitListDay(Date.parse("2026-09-03T08:00:00.000Z"))).toBe("3 Sept");
    expect(mapSplitListDay(null)).toBeNull();
    expect(mapSplitListDay("not a day")).toBeNull();
  });
});

describe("the list's order", () => {
  const cheap = venue({ id: "cheap", name: "Cheap Arms", cheapestPrice: 4.1, longitude: -0.1 });
  const dear = venue({ id: "dear", name: "Dear Tavern", cheapestPrice: 6.9, longitude: -0.1301 });
  const unpriced = venue({ id: "unpriced", name: "Quiet House", longitude: -0.1302 });

  it("puts the cheapest painted figure first and the unpriced after, nearest first", () => {
    const groups = buildMapSplitListGroups(input({ venues: [unpriced, dear, cheap] }));
    expect(groups.venues.map((row) => row.id)).toEqual(["cheap", "dear", "unpriced"]);
  });

  it("orders by distance alone when asked for the nearest", () => {
    const groups = buildMapSplitListGroups(input({ venues: [cheap, dear, unpriced], sort: "nearest" }));
    expect(groups.venues.map((row) => row.id)).toEqual(["dear", "unpriced", "cheap"]);
  });

  it("measures from the reader when the map knows where they are, and gives a walk only then", () => {
    const reader = { lng: -0.1, lat: 51.513 };
    const groups = buildMapSplitListGroups(input({ venues: [dear, cheap], sort: "nearest", reader }));
    expect(groups.venues.map((row) => row.id)).toEqual(["cheap", "dear"]);
    expect(groups.venues[0]?.walkMinutes).toBe(1);
    // About 2 km away: a walk past the peek's ceiling is not offered as one.
    const far = buildMapSplitListGroups(
      input({ venues: [venue({ id: "far", longitude: -0.4 })], reader }),
    );
    expect(far.venues[0]?.walkMinutes).toBeNull();
    expect(buildMapSplitListGroups(input({ venues: [cheap] })).venues[0]?.walkMinutes).toBeNull();
  });

  it("never ranks by anything but a price or a distance", () => {
    const rows = buildMapSplitListGroups(input({ venues: [dear, cheap] })).venues;
    expect(sortMapSplitListRows(rows, "cheapest").map((row) => row.id)).toEqual(["cheap", "dear"]);
    // The code, not its comments (which say there is no score), holds no rating.
    const code = readFileSync(join(process.cwd(), "lib/mapSplitList.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/rating|score|top rated/i);
    expect(code).toMatch(/export type MapSplitListSort = "cheapest" \| "nearest";/);
  });

  it("lists the unpriced pubs and restaurants after the venues, nearest first", () => {
    const pub = (id: string, lng: number): UkBasePub => ({ id, name: `Base ${id}`, lng, lat: 51.513 } as UkBasePub);
    const groups = buildMapSplitListGroups(
      input({
        venues: [cheap],
        basePubs: [
          { id: "b-far", name: "Base far", priceLabel: "Other pub · no listed price", pub: pub("b-far", -0.2) },
          { id: "b-near", name: "Base near", priceLabel: "Other pub · no listed price", pub: pub("b-near", -0.131) },
        ],
        restaurants: [
          { id: "r1", name: "Kitchen", priceLabel: "Restaurant · no listed price", lng: -0.13, lat: 51.513 },
        ],
      }),
    );
    expect(groups.basePubs.map((row) => row.id)).toEqual(["b-near", "b-far"]);
    expect(groups.basePubs[0]).toMatchObject({ group: "base", price: null, unpricedLabel: "Other pub · no listed price" });
    expect(groups.restaurants[0]).toMatchObject({ group: "restaurant", lng: -0.13 });
    expect(groups.total).toBe(4);
  });

  it("draws a page at a time and says how many more there are", () => {
    const venues = Array.from({ length: 5 }, (_, index) => venue({ id: `v${index}`, cheapestPrice: 4 + index }));
    const groups = buildMapSplitListGroups(
      input({
        venues,
        restaurants: [{ id: "r1", name: "Kitchen", priceLabel: "Restaurant · no listed price", lng: -0.13, lat: 51.513 }],
      }),
    );
    const first = pageMapSplitListGroups(groups, 3);
    expect(first.venues.map((row) => row.id)).toEqual(["v0", "v1", "v2"]);
    expect(first.restaurants).toEqual([]);
    expect(first).toMatchObject({ shown: 3, more: 3, total: 6 });
    const all = pageMapSplitListGroups(groups, 40);
    expect(all).toMatchObject({ shown: 6, more: 0 });
    expect(all.restaurants.map((row) => row.id)).toEqual(["r1"]);
  });
});

describe("the facts a row stands behind", () => {
  it("names the area and the first feature the map's own filters would keep the pub for", () => {
    const pub = venue({
      id: "venue-garden",
      locality: "Soho",
      filterHints: {
        searchText: "",
        amenities: { food: false, cocktails: false, beerGarden: true, nonAlcoholic: false },
        curation: { nearWater: false, hasStory: false },
        canonical: true,
        beerGardenSource: [true, "OpenStreetMap", "2026-01-01T00:00:00.000Z"],
      },
    });
    expect(mapSplitListFacts(pub)).toEqual(["Soho", "Beer garden"]);
  });

  it("says what a place is when it is not a pub, and never more than two facts", () => {
    expect(mapSplitListFacts(venue({ id: "venue-bar", kind: "bar", locality: "Soho" }))).toEqual(["Bar", "Soho"]);
    expect(mapSplitListFacts(venue({ id: "venue-plain", primaryBorough: "" }))).toEqual([]);
  });
});

describe("a pub opened from the list stays in sight", () => {
  it("carries the pin into the map left of the venue drawer, never under it", () => {
    // 1440 wide: the list takes 432px, the lane runs to 1440, the drawer starts at 800.
    expect(desktopSelectCameraOffset({ left: 432, width: 1008 }, 800)).toEqual([-320, 0]);
    // No drawer, or a drawer with no map beside it, moves nothing.
    expect(desktopSelectCameraOffset({ left: 432, width: 1008 }, null)).toEqual([0, 0]);
    expect(desktopSelectCameraOffset({ left: 0, width: 768 }, 0)).toEqual([0, 0]);
    // A drawer past the lane's right edge leaves the centre alone.
    expect(desktopSelectCameraOffset({ left: 0, width: 800 }, 900)).toEqual([0, 0]);
  });

  it("answers no drawer edge where there is no document", () => {
    expect(restingRightDrawerLeft(undefined)).toBeNull();
  });
});
