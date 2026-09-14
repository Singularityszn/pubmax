// A price recorded under an operator that has since left the pub is not
// evidence of today's price.
//
// The bundled dataset still held pre-sale J D Wetherspoon prices at three pubs
// the chain no longer runs: The Kentish Drovers (SE15 5RS, 18 rows, Bud Light
// and Greene King Abbot Ale at GBP 1.99), The Millers Well (E6 2JX, Carlsberg at
// GBP 2.39) and The Coronet (N7 6PA, Carlsberg at GBP 2.66). Once the chain's
// own directory stopped naming them, `tonightCheapPintChain` answered null and a
// stale GBP 1.99 chain pint topped Tonight's "Cheapest listed pints" as an
// uncapped independent.
//
// The rows stay in the dataset as dated history, each marked `price_superseded`
// with its reason, the day the operator left (null where nobody has proven one)
// and the evidence. No reader may treat a marked row as a price: not Tonight,
// not the map pin or the venue sheet, not the Pint Index and not /about.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeAboutStats } from "@/lib/aboutStats";
import type { PriceSuperseded } from "@/lib/priceRowEligibility.mjs";
import { tonightCheapPintChain, tonightCheapPints } from "@/lib/tonightCheapPints";
import { loadGroupedVenues } from "@/lib/venueDataset";
import { getPricedVenues, resetVenuePriceIndexForTests } from "@/lib/venuePriceIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { matchedWetherspoonsVenueIds } from "@/lib/wetherspoonsMatch.server";

const ROOT = process.cwd();

const RETIRED_PUBS = [
  {
    name: "The Kentish Drovers",
    venueId: "venue-1fabngq",
    reason: "chain_withdrew",
    leftOn: null,
    appPriceIds: Array.from({ length: 18 }, (_, index) => `app_price_00${2686 + index}`),
  },
  {
    name: "The Millers Well",
    venueId: "venue-10paqy",
    reason: "operator_change",
    leftOn: "2023-10-29",
    appPriceIds: ["app_price_002734"],
  },
  {
    name: "The Coronet",
    venueId: "venue-60y3sa",
    reason: "operator_change",
    leftOn: "2023-12-10",
    appPriceIds: ["app_price_001274"],
  },
] as const;

const RETIRED_VENUE_IDS = new Set<string>(RETIRED_PUBS.map((pub) => pub.venueId));

type MarkedRow = VenuePrice & { price_superseded?: unknown };

function datasetRows(): MarkedRow[] {
  return JSON.parse(
    readFileSync(join(ROOT, "public", "data", "pint_prices_app_dataset.json"), "utf8"),
  ) as MarkedRow[];
}

function row(over: Partial<MarkedRow>): MarkedRow {
  return {
    app_price_id: "app_price_test",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 5,
    price_text: "£5.00",
    address: "1 Test Street, London SE1 1AA",
    latitude: 51.5,
    longitude: -0.1,
    primary_borough: "Southwark",
    boroughs_visible: "Southwark",
    source_datasets: "",
    data_quality_notes: "",
    comment: "",
    description: "",
    website: "",
    booking_link: "",
    image_url: "",
    pub_url: "",
    ...over,
  } as MarkedRow;
}

const OPERATOR_LEFT: PriceSuperseded = {
  reason: "operator_change",
  operator: "J D Wetherspoon",
  left_on: "2023-12-10",
  evidence: "The chain's last day of trading at the pub.",
  evidence_urls: ["https://example.com/sale"],
  recorded_on: "2026-09-14",
};

describe("the dataset keeps a retired price as dated history", () => {
  const rows = datasetRows();
  const byId = new Map(rows.map((entry) => [entry.app_price_id, entry]));

  for (const pub of RETIRED_PUBS) {
    it(`keeps every ${pub.name} price row and marks it ${pub.reason}`, () => {
      for (const id of pub.appPriceIds) {
        const entry = byId.get(id);
        expect(entry?.pub_name).toBe(pub.name);
        // History is kept, never deleted or blanked.
        expect(typeof entry?.price_gbp).toBe("number");
        expect(entry?.price_superseded).toMatchObject({
          reason: pub.reason,
          operator: "J D Wetherspoon",
          left_on: pub.leftOn,
          recorded_on: "2026-09-14",
        });
        const marker = entry?.price_superseded as { evidence_urls: string[]; evidence: string };
        expect(marker.evidence.length).toBeGreaterThan(0);
        expect(marker.evidence_urls.length).toBeGreaterThan(0);
        for (const url of marker.evidence_urls) expect(url).toMatch(/^https:\/\//);
      }
    });
  }
});

describe("no reader treats a superseded row as a price", () => {
  it("groups a superseded row into its pub without pricing the pub", () => {
    const [venue] = groupVenuePrices([
      row({ pint_name: "Bud Light", price_gbp: 1.99, price_superseded: OPERATOR_LEFT }),
    ]);
    expect(venue.cheapestPrice).toBeNull();
    expect(venue.averagePrice).toBeNull();
    expect(venue.cheapestPint).toBe("");
    expect(venue.prices).toEqual([]);
  });

  it("prices a pub from its live rows alone", () => {
    const [venue] = groupVenuePrices([
      row({ app_price_id: "old", pint_name: "Bud Light", price_gbp: 1.99, price_superseded: OPERATOR_LEFT }),
      row({ app_price_id: "new", pint_name: "Guinness", price_gbp: 6.2 }),
    ]);
    expect(venue.cheapestPrice).toBe(6.2);
    expect(venue.cheapestPint).toBe("Guinness");
    expect(venue.prices.map((price) => price.app_price_id)).toEqual(["new"]);
  });

  it("keeps the pub's id, so a link to it still resolves", () => {
    const live = groupVenuePrices([row({ price_gbp: 1.99 })])[0];
    const retired = groupVenuePrices([row({ price_gbp: 1.99, price_superseded: OPERATOR_LEFT })])[0];
    expect(retired.id).toBe(live.id);
  });

  it("never lists a superseded pint on Tonight's cheap list", () => {
    const venues = groupVenuePrices([
      row({ pub_name: "The Old Spoons", pint_name: "Bud Light", price_gbp: 1.99, price_superseded: OPERATOR_LEFT }),
      row({ pub_name: "The Free House", address: "2 Test Street", pint_name: "Lager", price_gbp: 4.1 }),
    ]);
    const list = tonightCheapPints(
      venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        primaryBorough: venue.primaryBorough,
        cheapestPrice: venue.cheapestPrice,
        chain: tonightCheapPintChain(venue, new Set()),
      })),
    );
    expect(list.map((entry) => entry.name)).toEqual(["The Free House"]);
  });

  it("never ties a pub to a chain through a superseded row", () => {
    const [venue] = groupVenuePrices([
      row({
        pub_name: "The Old Spoons",
        price_gbp: 1.99,
        pub_url: "https://www.pint-prices.com/pub/The%20Old%20Spoons%20-%20JD%20Wetherspoon",
        price_superseded: OPERATOR_LEFT,
      }),
    ]);
    expect(tonightCheapPintChain(venue, new Set())).toBeNull();
  });

  it("leaves a superseded price out of /about's numbers", () => {
    const stats = computeAboutStats(
      [
        row({ pub_name: "The Old Spoons", price_gbp: 1.99, price_superseded: OPERATOR_LEFT }),
        row({ pub_name: "The Free House", address: "2 Test Street", price_gbp: 4.1 }),
      ],
      { historicPubsCited: 0, citiesCovered: 0 },
    );
    expect(stats.pintPricesObserved).toBe(1);
    expect(stats.cheapestPint).toBe(4.1);
  });
});

describe("the three retired pubs, read through every live surface", () => {
  beforeEach(() => {
    resetVenuePriceIndexForTests();
  });

  it("Tonight's cheap list names none of them at any length", async () => {
    const venues = await getPricedVenues();
    const wetherspoonIds = await matchedWetherspoonsVenueIds(
      venues.map((venue) => ({ id: venue.id, name: venue.name, lat: venue.latitude, lng: venue.longitude })),
    );
    const list = tonightCheapPints(
      venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        primaryBorough: venue.primaryBorough,
        cheapestPrice: venue.cheapestPrice,
        chain: tonightCheapPintChain(venue, wetherspoonIds),
      })),
      venues.length,
    );
    expect(list.filter((entry) => RETIRED_VENUE_IDS.has(entry.venueId))).toEqual([]);
  });

  it("the venue sheet and the Pint Index read each pub with no price", async () => {
    const [priced, grouped] = await Promise.all([getPricedVenues(), loadGroupedVenues()]);
    for (const venues of [priced, grouped]) {
      for (const pub of RETIRED_PUBS) {
        const venue = venues.find((candidate) => candidate.id === pub.venueId);
        expect(venue?.name).toBe(pub.name);
        expect(venue?.cheapestPrice).toBeNull();
        expect(venue?.prices).toEqual([]);
      }
    }
  });

  it("the committed map pins carry no price for any of them", () => {
    const slim = JSON.parse(
      readFileSync(join(ROOT, "public", "data", "venues_slim.json"), "utf8"),
    ) as { rows: Array<{ id: string; cheapestPrice: number | null }> };
    for (const pub of RETIRED_PUBS) {
      const pin = slim.rows.find((candidate) => candidate.id === pub.venueId);
      expect(pin).toBeDefined();
      expect(pin?.cheapestPrice).toBeNull();
    }
  });
});
