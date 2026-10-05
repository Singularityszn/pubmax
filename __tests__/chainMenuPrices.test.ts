// What a chain menu page is allowed to yield.
//
// The lane returns nothing today, so these are the tests that prove it would
// work the day a chain publishes a price: an untested harvester that yields
// zero is indistinguishable from a broken one.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHAIN_PINT_MAX_GBP,
  CHAIN_PINT_MIN_GBP,
  CHAIN_PRICE_DROP_REASONS,
  cheapestStatedPint,
  coverageLine,
  pageText,
  readChainPintPrices,
} from "@/lib/harvest/chainMenuPrices";
import { CATEGORY_PRICE_BANDS } from "@/lib/harvest/ukPriceCrawl";
import { defined } from "@/__tests__/helpers/defined";

const menuPage = (body: string) => `<!doctype html><html><head>
  <style>.price::after{content:"£9.99"}</style>
  <script>window.__DATA__={"price":"£3.33"}</script>
  </head><body>${body}</body></html>`;

describe("reading a chain menu page", () => {
  it("takes a pint price the page states", () => {
    const reading = readChainPintPrices(menuPage("<li>Camden Hells Lager, pint &pound;6.20</li>"));
    expect(reading.kept).toHaveLength(1);
    expect(defined(reading.kept[0]).priceGbp).toBe(6.2);
    expect(defined(reading.kept[0]).verbatim).toBe("£6.20");
  });

  it("never reads a price out of a script or a stylesheet", () => {
    // The £9.99 in CSS and the £3.33 in a script are not things the page states
    // to a reader, and a harvester that took them would be quoting our own
    // markup back at a pub.
    const text = pageText(menuPage("<li>Guinness, pint £6.20</li>"));
    expect(text).not.toContain("9.99");
    expect(text).not.toContain("3.33");
    expect(text).toContain("£6.20");
  });

  it("reports a page that states no price at all as a finding, not an empty list", () => {
    const reading = readChainPintPrices(menuPage("<p>Download our app to see pricing.</p>"));
    expect(reading.kept).toHaveLength(0);
    expect(reading.drops).toEqual(["no-price-on-page"]);
  });

  it("drops a figure with no drink word beside it", () => {
    const reading = readChainPintPrices(menuPage("<p>Room hire from £8.00 per hour</p>"));
    expect(reading.kept).toHaveLength(0);
    expect(reading.drops).toContain("no-drink-word-nearby");
  });

  it("drops a meal deal that happens to mention a pint", () => {
    const reading = readChainPintPrices(menuPage("<li>Burger and a pint £16.99</li>"));
    expect(reading.kept).toHaveLength(0);
    // `pint` is a measure, not a drink category, so the shared reader may drop
    // this as no drink word rather than as food. Either way it is not a pint.
    expect(
      reading.drops.some(
        (drop) =>
          drop === "food-word-nearby" || drop === "outside-pint-band" || drop === "no-drink-word-nearby",
      ),
    ).toBe(true);
  });

  it("drops a figure outside the pint band in either direction", () => {
    const cheap = readChainPintPrices(menuPage("<li>Lager £0.50</li>"));
    const dear = readChainPintPrices(menuPage("<li>Ale £99.00</li>"));
    expect(cheap.kept).toHaveLength(0);
    expect(dear.kept).toHaveLength(0);
    expect(CHAIN_PINT_MIN_GBP).toBeLessThan(CHAIN_PINT_MAX_GBP);
  });

  it("counts every drop with a reason from the closed set", () => {
    const reading = readChainPintPrices(
      menuPage("<li>Room hire £8.00</li><li>Lager £0.50</li><li>Burger and a pint £16.99</li>"),
    );
    expect(reading.drops.length).toBeGreaterThan(0);
    for (const drop of reading.drops) expect(CHAIN_PRICE_DROP_REASONS).toContain(drop);
  });

  it("takes the cheapest stated pint as the pub's own figure", () => {
    const reading = readChainPintPrices(
      menuPage("<li>Guinness pint £6.80</li><li>Carling pint £5.40</li><li>IPA pint £6.10</li>"),
    );
    expect(reading.kept).toHaveLength(3);
    expect(cheapestStatedPint(reading)).toBe(5.4);
  });

  it("answers null for the cheapest pint on a page that states none", () => {
    expect(cheapestStatedPint({ kept: [], drops: ["no-price-on-page"] })).toBeNull();
  });

  it("does not read a bitter lemon mixer as a pint", () => {
    const reading = readChainPintPrices(
      menuPage("<p>Bosford Rose, try with Britvic Bitter Lemon £7.25</p>"),
    );
    expect(reading.kept).toHaveLength(0);
  });

  it("uses the shared beer band rather than a second pint range", () => {
    expect(CHAIN_PINT_MIN_GBP).toBe(CATEGORY_PRICE_BANDS.beer?.minGbp);
    expect(CHAIN_PINT_MAX_GBP).toBe(CATEGORY_PRICE_BANDS.beer?.maxGbp);
  });

  it("has no drink-word table of its own", () => {
    const source = readFileSync(join(process.cwd(), "lib/harvest/chainMenuPrices.ts"), "utf8");
    expect(source).toMatch(/from "\.\/ukPriceCrawl"/);
    expect(source).not.toMatch(/neck oil\|madri/);
    expect(source).not.toMatch(/const PRICE_PATTERN/);
    expect(source).not.toMatch(/const DRINK_WORDS/);
  });
});

describe("the coverage line", () => {
  it("prints a zero city rather than rounding it away", () => {
    expect(coverageLine({ city: "bristol", pagesRead: 12, venuesPriced: 0, pagesWithNoPrice: 12 })).toBe(
      "bristol: 0 venues priced from 12 page(s) read, 12 stating no price",
    );
  });

  it("separates a city with nothing to read from one that read and found nothing", () => {
    expect(coverageLine({ city: "bath", pagesRead: 0, venuesPriced: 0, pagesWithNoPrice: 0 })).toBe(
      "bath: no permitted page to read",
    );
  });

  it("agrees in number with a single priced venue", () => {
    expect(coverageLine({ city: "london", pagesRead: 3, venuesPriced: 1, pagesWithNoPrice: 2 })).toContain(
      "1 venue priced",
    );
  });
});
