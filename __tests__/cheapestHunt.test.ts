import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCheapestHunt,
  bundleHuntPints,
  citiesWithUnnamedPints,
  huntPlaceResolver,
  huntRowNamesItsDrink,
  londonHuntPints,
  nearestTownName,
  type HuntPint,
  type HuntPlaceSources,
} from "@/lib/cheapestHunt";
import { listEnabledCities } from "@/lib/cities";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import type { Venue } from "@/lib/venues";

// THE CHEAPEST PINT WE CAN FIND HAS ONE OWNER (captain decisions 2 and 3,
// 1 Nov 2026). These are the laws it keeps: an estimate never wins, a row with
// no date or no publisher never wins, a half or a bar the public cannot walk
// into never wins, every city on the map gets a row (priced or honestly
// empty), and London's dearest pint is read from our London pub list alone.

const NOW = Date.UTC(2026, 10, 1, 12);

function londonVenue(
  id: string,
  name: string,
  price: number | null,
  {
    pubUrl = "https://www.pint-prices.com/pub/x",
    readAt = "2026-10-02T11:48:33+00:00",
    pintName = "JAIPUR",
  } = {},
): Venue {
  return {
    id,
    name,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "Southwark",
    visibleBoroughs: ["Southwark"],
    prices: [
      {
        app_price_id: id,
        pub_name: name,
        pint_name: pintName,
        price_gbp: price,
        price_text: price === null ? "" : `£${price}`,
        address: "1 Test Street",
        latitude: 51.5,
        longitude: -0.1,
        pub_url: pubUrl,
        scraped_at_values: readAt,
      } as Venue["prices"][number],
    ],
    cheapestPrice: price,
    cheapestPint: pintName,
    averagePrice: price,
    hasStory: false,
  } as Venue;
}

function row(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return {
    venueId: "venue-uk-n1",
    name: "The Test Arms",
    category: "beer",
    priceGbp: 3,
    lane: "site-harvest",
    standing: "listed",
    sourceUrl: "https://testarms.co.uk/drinks",
    publisher: "testarms.co.uk",
    observedAt: "2026-10-01T10:00:00.000Z",
    basis: null,
    sampleSize: null,
    // A row that names its drink, so it clears the headline bar unless a test
    // says otherwise.
    drinkLabel: "Pale Ale",
    ...overrides,
  };
}

/** The Enid Street Tavern shape (18 Oct 2026): beer, £2, no label, no serving. */
function unnamedRow(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  const bare = row({ priceGbp: 2, ...overrides });
  delete bare.drinkLabel;
  return bare;
}

function byVenue(rows: UkPriceBundleRow[]): Map<string, UkPriceBundleRow[]> {
  const map = new Map<string, UkPriceBundleRow[]>();
  for (const entry of rows) map.set(entry.venueId, [...(map.get(entry.venueId) ?? []), entry]);
  return map;
}

const SOURCES: HuntPlaceSources = {
  londonPubNames: new Map([["venue-lon1", "The Listed Lion"]]),
  basePubs: new Map([
    // Inside Manchester's box (lib/cityBounds.mjs).
    ["venue-uk-n1", { name: "The Test Arms", lat: 53.48, lng: -2.24 }],
    // Edinburgh: on no city map of ours.
    ["venue-uk-n2", { name: "The Far Inn", lat: 55.9533, lng: -3.1883 }],
    // A remote pub further than any town's reach.
    ["venue-uk-n3", { name: "The Lonely Pub", lat: 58.5, lng: -6.2 }],
    ["venue-uk-n4", { name: "The Edge Inn", lat: 51.2, lng: -2.75 }],
  ]),
  towns: [
    { name: "Edinburgh", lat: 55.953, lng: -3.188 },
    { name: "Glastonbury", lat: 51.148, lng: -2.714 },
  ],
};

const placeOf = huntPlaceResolver(SOURCES);

function bundle(rows: UkPriceBundleRow[]): HuntPint[] {
  return bundleHuntPints(byVenue(rows), placeOf, NOW);
}

describe("what may win a cheapest line", () => {
  it("never lets an estimate win, however cheap", () => {
    const pints = bundle([
      row({ standing: "estimate", lane: "estimate", priceGbp: 1, basis: "london_borough:southwark", sampleSize: 40, sourceUrl: null, publisher: null }),
      row({ venueId: "venue-uk-n2", name: "The Far Inn", standing: "estimate", lane: "estimate", priceGbp: 0.5, basis: "x", sampleSize: 12, sourceUrl: null, publisher: null }),
      row({ priceGbp: 4.2 }),
    ]);
    expect(pints.map((pint) => [pint.venueId, pint.priceGbp, pint.standing])).toEqual([["venue-uk-n1", 4.2, "listed"]]);
    expect(buildCheapestHunt(pints).britain?.priceGbp).toBe(4.2);
  });

  it("never lets a row with no publisher or no read day win", () => {
    expect(bundle([row({ publisher: null, priceGbp: 1.5 })])).toEqual([]);
    expect(bundle([row({ publisher: "   ", priceGbp: 1.5 })])).toEqual([]);
    expect(bundle([row({ observedAt: "not a day", priceGbp: 1.5 })])).toEqual([]);
    expect(bundle([row({ sourceUrl: null, priceGbp: 1.5 })])).toEqual([]);
    // A listing past its window is history, not a price tonight (lib/priceTier.ts).
    expect(bundle([row({ observedAt: "2024-06-01T10:00:00.000Z", priceGbp: 1.5 })])).toEqual([]);
  });

  it("never lets a half, a third or a bottle stand for a pint, and never scales one", () => {
    const pints = bundle([
      row({ drinkLabel: "1/2 Pint Lager", priceGbp: 1.8 }),
      row({ drinkLabel: "Neck Oil half", priceGbp: 1.85 }),
      row({ servingSize: "half", drinkLabel: "Pale", priceGbp: 1.9 }),
      row({ servingSize: "Btl", drinkLabel: "Peroni", priceGbp: 1.95 }),
      row({ drinkLabel: "Half Moon IPA", priceGbp: 4.4 }),
    ]);
    // "Half Moon IPA" is a beer's name, not a measure, so it stands at its own figure.
    expect(pints.map((pint) => pint.priceGbp)).toEqual([4.4]);
  });

  it("never names a bar the public cannot walk into", () => {
    expect(bundle([row({ name: "Students' Union Bar", priceGbp: 1.2 })])).toEqual([]);
    expect(londonHuntPints([londonVenue("venue-lon9", "Railway Club", 1.1)], NOW)).toEqual([]);
  });

  it("reads the London list the way the landing's pub card does: listed, published and dated", () => {
    const pints = londonHuntPints(
      [
        londonVenue("venue-lon1", "The Listed Lion", 2.09),
        londonVenue("venue-lon2", "No Publisher Arms", 1.5, { pubUrl: "" }),
        londonVenue("venue-lon3", "No Read Day Tavern", 1.6, { readAt: "" }),
        londonVenue("venue-lon4", "The Stale Stag", 1.7, { readAt: "2024-01-01T00:00:00+00:00" }),
        londonVenue("venue-lon5", "The Dry Dock", null),
      ],
      NOW,
    );
    expect(pints).toEqual([
      {
        venueId: "venue-lon1",
        pubName: "The Listed Lion",
        cityId: "london",
        placeName: "London",
        priceGbp: 2.09,
        publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
        observedOn: "2026-10-02",
        standing: "listed",
        lane: "london-list",
        mapHref: "/map?sel=venue-lon1",
      },
    ]);
  });
});

// THE HEADLINE BAR: a winner names its drink. The first build crowned Enid
// Street Tavern's £2.00 taplist "beer" (read 18 Oct 2026), a row with no label
// and no serving from a harvest whose other labels read "/" and "13.0% (".
describe("the headline bar: a winner names its drink", () => {
  it("never lets the Enid Street row shape win: beer, £2, no label, no serving", () => {
    const pints = bundle([
      unnamedRow({ venueId: "venue-uk-n2", name: "Enid Street Tavern" }),
      row({ priceGbp: 3.4, drinkLabel: "Neck Oil" }),
    ]);
    expect(pints.map((pint) => [pint.pubName, pint.priceGbp])).toEqual([["The Test Arms", 3.4]]);
    expect(buildCheapestHunt(pints).britain).toMatchObject({ pubName: "The Test Arms", priceGbp: 3.4 });
  });

  it("lets a labelled pint win, and a stated pint serving win with no label", () => {
    expect(bundle([row({ priceGbp: 2.6, drinkLabel: "Cruzcampo" })]).map((pint) => pint.priceGbp)).toEqual([2.6]);
    expect(bundle([unnamedRow({ priceGbp: 2.7, servingSize: "pint" })]).map((pint) => pint.priceGbp)).toEqual([2.7]);
    expect(bundle([unnamedRow({ priceGbp: 2.8, servingSize: "568ml" })]).map((pint) => pint.priceGbp)).toEqual([2.8]);
  });

  it("reads punctuation and ABV fragments as no name at all", () => {
    for (const drinkLabel of ["/", "13.0% (", "11.0% (", "  ", "4,5 % -"]) {
      expect(huntRowNamesItsDrink({ drinkLabel }), drinkLabel).toBe(false);
      expect(bundle([row({ priceGbp: 1.5, drinkLabel })]), drinkLabel).toEqual([]);
    }
    for (const drinkLabel of ["Pint of Beer", "IPA", "John Smith’s", "Shenanigans Lager 4.0%"]) {
      expect(huntRowNamesItsDrink({ drinkLabel }), drinkLabel).toBe(true);
    }
    expect(huntRowNamesItsDrink({ servingSize: "half" })).toBe(false);
    expect(huntRowNamesItsDrink({})).toBe(false);
  });

  it("asks the London list's own row to name its pint, and holds out one that names none", () => {
    const pints = londonHuntPints(
      [
        londonVenue("venue-lon1", "The Listed Lion", 2.09),
        londonVenue("venue-lon2", "The Nameless", 1.5, { pintName: "" }),
        londonVenue("venue-lon3", "The Fraction", 1.6, { pintName: "13.0% (" }),
        londonVenue("venue-lon4", "The Half Measure", 1.7, { pintName: "1/2 Lager" }),
      ],
      NOW,
    );
    expect(pints.map((pint) => pint.pubName)).toEqual(["The Listed Lion"]);
  });

  it("keeps a city that holds only unnamed prices off the empty line, without crowning it", () => {
    const rows = [unnamedRow({ venueId: "venue-oxf-abc123", name: "The Unnamed Oxford" })];
    expect(bundle(rows)).toEqual([]);
    const unnamed = citiesWithUnnamedPints(byVenue(rows), placeOf, NOW);
    expect([...unnamed]).toEqual(["oxford"]);
    const hunt = buildCheapestHunt([], unnamed);
    const oxford = hunt.cities.find((city) => city.cityId === "oxford");
    expect(oxford).toMatchObject({ pint: null, unnamedPricesHeld: true });
    expect(hunt.cities.find((city) => city.cityId === "bath")).toMatchObject({ pint: null, unnamedPricesHeld: false });
  });

  it("never lets a students' union bar win a city", () => {
    const pints = bundle([
      row({ venueId: "venue-bhm-xbhlre", name: "Eagle & Ball by BCUSU", priceGbp: 2.5, drinkLabel: "Carling" }),
      row({ venueId: "venue-bhm-1kho5a7", name: "The Botanist Gas Street Basin", priceGbp: 4.95, drinkLabel: "Pint of Pravha" }),
    ]);
    const birmingham = buildCheapestHunt(pints).cities.find((city) => city.cityId === "birmingham");
    expect(birmingham?.pint).toMatchObject({ pubName: "The Botanist Gas Street Basin", priceGbp: 4.95 });
  });
});

describe("where a pint is", () => {
  it("places a base pub by its own point: in a map city, or by its nearest town", () => {
    const pints = bundle([
      row({ priceGbp: 3.1 }),
      row({ venueId: "venue-uk-n2", name: "The Far Inn", priceGbp: 2.5 }),
      row({ venueId: "venue-uk-n3", name: "The Lonely Pub", priceGbp: 1 }),
      row({ venueId: "venue-uk-n4", name: "The Edge Inn", priceGbp: 2.8 }),
      row({ venueId: "venue-uk-n9", name: "The Unknown", priceGbp: 0.9 }),
    ]);
    const where = Object.fromEntries(pints.map((pint) => [pint.pubName, [pint.cityId, pint.placeName]]));
    expect(where).toEqual({
      "The Test Arms": ["manchester", "Manchester"],
      "The Far Inn": [null, "Edinburgh"],
      "The Edge Inn": [null, "near Glastonbury"],
    });
    // A base pub opens on the map at its own point, so the map can find it.
    expect(pints.find((pint) => pint.pubName === "The Far Inn")?.mapHref).toBe(
      "/map?sel=venue-uk-n2&at=55.9533,-3.1883",
    );
  });

  it("names a curated pub's city from its id, and a nameless London row from our pub list", () => {
    const pints = bundle([
      row({ venueId: "venue-bhm-abc123", name: "The Brum Tap", priceGbp: 3.5 }),
      row({ venueId: "venue-lon1", name: null, lane: "drink-price-update", publisher: "The Listed Lion, official website", priceGbp: 4 }),
    ]);
    expect(pints.map((pint) => [pint.pubName, pint.cityId, pint.mapHref])).toEqual([
      ["The Brum Tap", "birmingham", "/map/birmingham?sel=venue-bhm-abc123"],
      ["The Listed Lion", "london", "/map?sel=venue-lon1"],
    ]);
  });

  it("says near past three kilometres and names no town past its reach", () => {
    expect(nearestTownName({ lat: 55.95, lng: -3.19 }, SOURCES.towns)).toBe("Edinburgh");
    expect(nearestTownName({ lat: 51.2, lng: -2.75 }, SOURCES.towns)).toBe("near Glastonbury");
    expect(nearestTownName({ lat: 58.5, lng: -6.2 }, SOURCES.towns)).toBeNull();
  });
});

describe("the hunt", () => {
  const london = londonHuntPints(
    [
      londonVenue("venue-lon1", "The Listed Lion", 2.09),
      londonVenue("venue-lon2", "The Dear Duke", 9.5),
      londonVenue("venue-lon3", "The Middle Mile", 5.2),
    ],
    NOW,
  );
  const uk = bundle([
    row({ priceGbp: 3.1 }),
    row({ venueId: "venue-uk-n2", name: "The Far Inn", priceGbp: 2.5 }),
    row({ venueId: "venue-bhm-abc123", name: "The Brum Tap", priceGbp: 2.09, observedAt: "2026-10-20T10:00:00.000Z" }),
    // A bundle "beer" line dearer than anything on our London list: the press
    // card must never quote it (an £11 fish-finger line did exactly this).
    row({ venueId: "venue-lon3", name: "The Middle Mile", priceGbp: 11 }),
  ]);
  const hunt = buildCheapestHunt([...london, ...uk]);

  it("finds the cheapest pint in Britain, the freshest read winning a tie", () => {
    expect(hunt.britain).toMatchObject({ pubName: "The Brum Tap", priceGbp: 2.09, observedOn: "2026-10-20" });
  });

  it("gives every city on the map a row, and an empty one its own price door", () => {
    expect(hunt.cities.map((city) => city.cityId)).toEqual(listEnabledCities().map((city) => city.id));
    const byCity = Object.fromEntries(hunt.cities.map((city) => [city.cityId, city]));
    expect(byCity.london?.pint).toMatchObject({ pubName: "The Listed Lion", priceGbp: 2.09 });
    expect(byCity.manchester?.pint).toMatchObject({ pubName: "The Test Arms", priceGbp: 3.1 });
    expect(byCity.birmingham?.pint).toMatchObject({ pubName: "The Brum Tap" });
    expect(byCity.bath?.pint).toBeNull();
    expect(byCity.bath?.logHref).toBe("/map/bath?log=1");
    expect(byCity.london?.logHref).toBe("/map?log=1");
  });

  it("keeps a priced pub outside every map city in its own row", () => {
    expect(hunt.elsewhere).toMatchObject({ pubName: "The Far Inn", cityId: null, placeName: "Edinburgh" });
  });

  it("reads London's dearest pint from our London pub list alone", () => {
    expect(hunt.londonDearest).toMatchObject({ pubName: "The Dear Duke", priceGbp: 9.5, lane: "london-list" });
  });

  it("holds one pint per pub, its cheaper claim, when both lanes know it", () => {
    const both = buildCheapestHunt([
      ...londonHuntPints([londonVenue("venue-lon1", "The Listed Lion", 4.5)], NOW),
      ...bundle([row({ venueId: "venue-lon1", name: "The Listed Lion", priceGbp: 3.9 })]),
    ]);
    expect(both.cities.find((city) => city.cityId === "london")?.pint).toMatchObject({
      priceGbp: 3.9,
      lane: "uk-bundle",
    });
  });

  it("names nobody when nothing may win, and still lists every city as empty", () => {
    const empty = buildCheapestHunt([]);
    expect(empty.britain).toBeNull();
    expect(empty.londonDearest).toBeNull();
    expect(empty.elsewhere).toBeNull();
    expect(empty.cities.every((city) => city.pint === null)).toBe(true);
  });
});

// NEVER A PIN COLOUR, NEVER ON THE MAP. The hunt is read by the front door and
// nothing else, so London's dearest pint can only ever be a press card.
describe("the hunt's readers", () => {
  const ROOT = join(__dirname, "..");
  const ALLOWED = new Set([
    "app/page.tsx",
    "lib/cheapestHunt.server.ts",
    "components/landing/LandingHuntCard.tsx",
    "components/landing/LandingHuntCities.tsx",
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("is imported only by the landing and its own wiring", () => {
    const readers = ["app", "components", "lib"]
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => /from\s+["']@\/lib\/cheapestHunt(\.server)?["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split("\\").join("/"));
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });
});
