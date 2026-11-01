import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import NearCheapestAnything from "@/components/nearme/NearCheapestAnything";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import {
  cheapestDrinksNearby,
  NEAR_DRINK_CHIPS,
  NEAR_DRINK_SIZE_NOT_STATED,
  nearDrinkEmptyLine,
  nearDrinkMeasureLabel,
  nearGuinnessRows,
  nearPintRows,
  type NearDrinkPoint,
  type NearDrinkRow,
} from "@/lib/nearCheapestAnything";
import {
  buildNearDrinkLanes,
  isAlcoholFreeLabel,
  isCoffeeLabel,
  isHouseWineLabel,
} from "@/lib/nearCheapestAnything.server";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import type { Venue, VenuePrice } from "@/lib/venues";

// Cheapest anything (launch plan section 3): one chip per drink, each the
// cheapest LISTED one within 15 minutes, a measure stated or "size not
// stated" and never compared across, and an honest empty answer.

const here = { lat: 51.5074, lng: -0.1278 };

function point(id: string, dLat: number, overrides: Partial<NearDrinkPoint> = {}): NearDrinkPoint {
  return {
    id,
    name: `The ${id}`,
    lat: here.lat + dLat,
    lng: here.lng,
    borough: "Westminster",
    cheapestPrice: 5,
    priceSource: "Pint Prices",
    priceObservedAt: "2026-10-02",
    ...overrides,
  };
}

const near = point("near", 0.002);
const nearer = point("nearer", 0.001);
const far = point("far", 0.02);

describe("the chip row", () => {
  it("offers Pint first, then Guinness, House wine, Coke, Coffee and Alcohol-free", () => {
    expect(NEAR_DRINK_CHIPS.map((chip) => chip.label)).toEqual([
      "Pint",
      "Guinness",
      "House wine",
      "Coke",
      "Coffee",
      "Alcohol-free",
    ]);
  });
});

describe("cheapestDrinksNearby", () => {
  it("answers the cheapest listed row within the walk, nearer on a tie", () => {
    const rows: NearDrinkRow[] = [
      ["near", 4.2, "2026-10-02", "pub.co.uk", "Espresso", null],
      ["nearer", 4.2, "2026-10-01", "pub.co.uk", "Americano", null],
      ["far", 1.5, "2026-10-02", "pub.co.uk", "Espresso", null],
    ];
    const answers = cheapestDrinksNearby(here.lat, here.lng, [near, nearer, far], rows);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ id: "nearer", priceGbp: 4.2, drinkLabel: "Americano", publisher: "pub.co.uk" });
  });

  it("gives each measure its own answer and never compares a measured row with one of no stated size", () => {
    const rows: NearDrinkRow[] = [
      ["near", 6.5, "2026-10-02", "pub.co.uk", "Merlot", "175ml"],
      ["nearer", 8.9, "2026-10-02", "pub.co.uk", "Rioja", "250ml"],
      ["near", 3.9, "2026-10-02", "pub.co.uk", "House red", null],
    ];
    const answers = cheapestDrinksNearby(here.lat, here.lng, [near, nearer], rows);
    // A £3.90 row with no stated size does not beat the £6.50 glass: it is a
    // separate answer, printed last, under its own words.
    expect(answers.map((answer) => [answer.measure, answer.priceGbp])).toEqual([
      ["175ml", 6.5],
      ["250ml", 8.9],
      [null, 3.9],
    ]);
    expect(nearDrinkMeasureLabel("175ml")).toBe("175 ml");
    expect(nearDrinkMeasureLabel(null)).toBe(NEAR_DRINK_SIZE_NOT_STATED);
    expect(NEAR_DRINK_SIZE_NOT_STATED).toBe("Size not stated");
  });

  it("answers nothing when no priced row is in the walk", () => {
    expect(cheapestDrinksNearby(here.lat, here.lng, [far], [["far", 2, "2026-10-02", null, "Espresso", null]])).toEqual([]);
    expect(cheapestDrinksNearby(here.lat, here.lng, [near], [])).toEqual([]);
    expect(cheapestDrinksNearby(here.lat, here.lng, [near], [["not-in-index", 2, null, null, "Espresso", null]])).toEqual([]);
  });

  it("words the empty answer as a sentence for every chip", () => {
    expect(nearDrinkEmptyLine("coffee")).toBe("No listed coffee within 15 minutes' walk.");
    expect(nearDrinkEmptyLine("coke")).toBe("No listed Diet Coke or Coke Zero within 15 minutes' walk.");
    for (const chip of NEAR_DRINK_CHIPS) expect(nearDrinkEmptyLine(chip.id)).toMatch(/^No listed .+ within 15 minutes' walk\.$/);
  });
});

describe("the pint and Guinness lanes", () => {
  it("reads a pint only where the index names its publisher and its read day", () => {
    const rows = nearPintRows([
      near,
      point("no-source", 0.001, { priceSource: undefined }),
      point("no-day", 0.001, { priceObservedAt: undefined }),
      point("unpriced", 0.001, { cheapestPrice: null }),
    ]);
    expect(rows).toEqual([["near", 5, "2026-10-02", "Pint Prices", null, "pint"]]);
  });

  it("reads the Guinness line's own rows as pints, with their publisher", () => {
    expect(nearGuinnessRows([["a", 5.2, "2026-09-14", "Pint Prices"], ["b", 4.9, null]])).toEqual([
      ["a", 5.2, "2026-09-14", "Pint Prices", null, "pint"],
      ["b", 4.9, null, null, null, "pint"],
    ]);
    expect(nearGuinnessRows(undefined)).toBeUndefined();
  });
});

describe("which listed rows a lane holds", () => {
  it("House wine is a still red, white or rosé the label names", () => {
    expect(isHouseWineLabel("Merlot, Chile")).toBe(true);
    expect(isHouseWineLabel("Pinot Grigio")).toBe(true);
    expect(isHouseWineLabel("Prosecco DOC")).toBe(false);
    expect(isHouseWineLabel("Raspberry & Rose Lemonade")).toBe(false);
    expect(isHouseWineLabel("Limoncello Spritz")).toBe(false);
    expect(isHouseWineLabel("/")).toBe(false);
    expect(isHouseWineLabel(undefined)).toBe(false);
  });

  it("Coffee is a coffee the label names, never a coffee cocktail", () => {
    expect(isCoffeeLabel("Flat white")).toBe(true);
    expect(isCoffeeLabel("Single Espresso")).toBe(true);
    expect(isCoffeeLabel("Espresso Martini")).toBe(false);
    expect(isCoffeeLabel("Limoncello Luxardo")).toBe(false);
    expect(isCoffeeLabel("Croutons, Ceasar Dressing 391 kcal Desserts Affogato")).toBe(false);
  });

  it("an alcohol-free row needs a name", () => {
    expect(isAlcoholFreeLabel("Lucky Saint")).toBe(true);
    expect(isAlcoholFreeLabel("")).toBe(false);
  });
});

describe("buildNearDrinkLanes (the server half)", () => {
  const priceRow = {
    pub_name: "The Crown",
    address: "1 High St",
    latitude: 51.5,
    longitude: -0.12,
    pint_name: "Lager",
    price_gbp: 5,
  } as unknown as VenuePrice;
  const venue = {
    id: "venue-crown",
    name: "The Crown",
    kind: "pub",
    prices: [priceRow],
  } as unknown as Venue;

  function bundle(row: Partial<UkPriceBundleRow>): UkPriceBundleRow {
    return {
      venueId: "venue-crown",
      name: "The Crown",
      category: "wine",
      priceGbp: 6,
      lane: "site-harvest",
      standing: "listed",
      sourceUrl: "https://www.thecrown.co.uk/drinks",
      publisher: null,
      observedAt: "2026-10-17T12:00:00.000Z",
      basis: null,
      sampleSize: null,
      ...row,
    };
  }

  it("keeps the cheapest listed row per measure, with its publisher, day and stated size", () => {
    const lanes = buildNearDrinkLanes([venue], [], new Map([["venue-crown", [
      bundle({ drinkLabel: "Merlot", priceGbp: 7.5, servingSize: "175ml" }),
      bundle({ drinkLabel: "Shiraz", priceGbp: 6.8, servingSize: "175 ml" }),
      bundle({ drinkLabel: "House white", priceGbp: 5.1 }),
      bundle({ drinkLabel: "Prosecco", priceGbp: 4 }),
      bundle({ drinkLabel: "Merlot", priceGbp: 3, lane: "estimate", standing: "estimate" }),
    ]]]));
    expect(lanes.wine).toEqual([
      ["venue-crown", 6.8, "2026-10-17", "thecrown.co.uk", "Shiraz", "175ml"],
      ["venue-crown", 5.1, "2026-10-17", "thecrown.co.uk", "House white", null],
    ]);
  });

  it("never lets an estimate or a demo row into a lane", () => {
    const demo = {
      venueKey: "x",
      drinkName: "Flat white",
      category: "coffee",
      priceGbp: 1,
      source: { label: "Demo", url: "https://example.com", licence: "demo" },
      observedAt: "2026-10-01T00:00:00.000Z",
      lane: "demo",
    } as DrinkPriceUpdate;
    const lanes = buildNearDrinkLanes([venue], [demo], new Map([["venue-crown", [
      bundle({ category: "coffee", drinkLabel: "Flat white", priceGbp: 0.5, lane: "estimate", standing: "estimate" }),
    ]]]));
    expect(lanes.coffee).toEqual([]);
  });

  it("reads Coke through the soft-drinks page's Coca-Cola lens, size not stated", () => {
    const lanes = buildNearDrinkLanes([venue], [], new Map([["venue-crown", [
      bundle({ category: "soft-drink", drinkLabel: "Diet Coke", priceGbp: 3.2 }),
      bundle({ category: "soft-drink", drinkLabel: "Pepsi Max", priceGbp: 2.5 }),
    ]]]));
    // The publisher is the soft-drinks page's own label for the row.
    expect(lanes.coke).toEqual([["venue-crown", 3.2, "2026-10-17", "www.thecrown.co.uk", "Diet Coke", null]]);
  });
});

describe("the chip row renders", () => {
  const venues = [near, nearer];
  const lanes = {
    wine: [["near", 6.5, "2026-10-02", "pub.co.uk", "Merlot", "175ml"], ["nearer", 3.9, "2026-10-02", "pub.co.uk", "House red", null]] as NearDrinkRow[],
    coffee: [] as NearDrinkRow[],
  };

  it("opens on Pint with the listed pint, its source and day, and the walk", () => {
    const html = renderToStaticMarkup(<NearCheapestAnything centre={here} venues={venues} lanes={lanes} />);
    expect(html).toContain("Cheapest anything");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Pint</);
    expect(html).toContain("Cheapest pint within 15 minutes");
    expect(html).toContain("£5.00");
    expect(html).toContain("On record · Pint Prices · read 2 Oct");
    expect(html).toContain("min walk");
  });

  it("prints a wine's measure, keeps a size-not-stated row apart and says so", () => {
    const html = renderToStaticMarkup(<NearCheapestAnything centre={here} venues={venues} lanes={lanes} initialChip="wine" />);
    expect(html).toContain("175 ml");
    expect(html).toContain("Size not stated");
    expect(html).toContain("Each size is its own answer.");
    expect(html).toContain("Merlot");
  });

  it("says nothing is listed nearby, or that the prices could not be read", () => {
    const empty = renderToStaticMarkup(<NearCheapestAnything centre={here} venues={venues} lanes={lanes} initialChip="coffee" />);
    expect(empty).toContain("No listed coffee within 15 minutes&#x27; walk.");
    const unread = renderToStaticMarkup(<NearCheapestAnything centre={here} venues={venues} lanes={lanes} initialChip="alcohol-free" />);
    expect(unread).toContain("We could not read listed alcohol-free drink prices just now.");
  });

  it("links the Guinness answer to the governed brand page", () => {
    const html = renderToStaticMarkup(
      <NearCheapestAnything
        centre={here}
        venues={venues}
        lanes={{ ...lanes, guinness: nearGuinnessRows([["near", 5.6, "2026-10-02", "Pint Prices"]]) }}
        initialChip="guinness"
      />,
    );
    expect(html).toContain('href="/drink/guinness"');
    expect(html).toContain("£5.60");
  });
});
