// WHAT A PUB'S OWN PAGE IS ALLOWED TO YIELD.
//
// The first run of this crawler read a Brewers Fayre banner saying
// "happy hour 2 for £9" beside the word "pint" and wrote £9 onto 27 pubs as the
// price of a beer. Every case below is one of the rules that stops that,
// written from the page text that caused it.

import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import {
  CATEGORY_PRICE_BANDS,
  MIN_PRICED_LINES_FOR_LIST,
  UK_PRICE_DROP_REASONS,
  categoryFor,
  cheapestPerCategory,
  isLikelyMenuUrl,
  menuLinkCandidates,
  pageMayPriceThisPub,
  pageStatesADrinksList,
  pageText,
  pubNameSlug,
  readVenueDrinkPrices,
  sitemapLocations,
} from "@/lib/harvest/ukPriceCrawl";

const drinksList = `
<html><body>
  <h2>Draught</h2>
  <p>Madri pint &pound;6.20</p>
  <p>Guinness pint &pound;6.40</p>
  <p>Neck Oil pint &pound;6.80</p>
  <p>House red wine 175ml &pound;7.50</p>
  <p>Gordon's gin and tonic &pound;8.00</p>
</body></html>`;

describe("what a page states", () => {
  it("reads the text a reader sees and drops what a script says", () => {
    const text = pageText('<script>var p = "£4.00";</script><p>Madri pint &pound;6.20</p>');
    expect(text).toBe("Madri pint £6.20");
  });

  it("keeps a stated price per drink and names its category", () => {
    const reading = readVenueDrinkPrices(drinksList);
    expect(cheapestPerCategory(reading)).toEqual([
      { category: "beer", priceGbp: 6.2 },
      { category: "gin", priceGbp: 8 },
      { category: "wine", priceGbp: 7.5 },
    ]);
  });

  it("answers one finding rather than an empty list when the page states no figure", () => {
    expect(readVenueDrinkPrices("<p>Open until late</p>").drops).toEqual(["no-price-on-page"]);
  });

  it("refuses an offer, however clearly it names a drink", () => {
    const reading = readVenueDrinkPrices(
      "<p>Get in a round with our NEW happy hour 2 for &pound;9 on every pint</p>",
    );
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toContain("offer-not-a-menu-price");
  });

  it("refuses a range floor, because nothing is sold at it", () => {
    const reading = readVenueDrinkPrices("<p>Wines by the glass from &pound;5.50</p>");
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toContain("offer-not-a-menu-price");
  });

  it("refuses a plate, checked after the drink word", () => {
    const reading = readVenueDrinkPrices("<p>Steak and a pint of ale &pound;16.99</p>");
    expect(reading.kept).toEqual([]);
  });

  it("holds each drink to its own band, so a fair cocktail is not an impossible pint", () => {
    expect(readVenueDrinkPrices("<p>Pint of lager &pound;16.00</p>").drops).toContain(
      "outside-category-band",
    );
    expect(readVenueDrinkPrices("<p>Espresso martini cocktail &pound;14.00</p>").kept).toHaveLength(1);
  });

  it("takes the pint off a draught line and leaves the half behind", () => {
    const reading = readVenueDrinkPrices(
      "<p>Draft beer Pilsner Half &pound;2.50 &pound;5.00 Peroni Half &pound;3.55 &pound;7.10</p>",
    );
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([5, 7.1]);
    expect(reading.drops.filter((reason) => reason === "half-measure-not-a-pint")).toHaveLength(2);
  });

  it("takes the second figure of a slash pair, because the first is the half", () => {
    const reading = readVenueDrinkPrices(
      "<p>Draught Guinness 4.3% &pound;2.30/&pound;4.60 Pravha 4% &pound;2.35/&pound;4.70 Madri 4.6% &pound;2.50/&pound;5.00 Atlantic Pale Ale &pound;2.30/&pound;4.80</p>",
    );
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([4.6, 4.7, 5, 4.8]);
  });

  it("names alcohol-free before beer, and a cocktail before a coffee", () => {
    expect(categoryFor("Lucky Saint alcohol-free lager")).toBe("alcohol-free");
    expect(categoryFor("Espresso martini")).toBe("cocktail");
  });

  it("knows a ginger ale is a soft drink and a measure is not a drink", () => {
    expect(categoryFor("Ginger Ale")).toBe("soft-drink");
    // `pint` names a glass, not what is in it, so a lemonade sold by the pint
    // stays a soft drink.
    expect(categoryFor("Pepsi Max / Lemonade 16oz, Pint")).toBe("soft-drink");
  });

  it("leaves a bottle behind, because it is not the pint on the same page", () => {
    const reading = readVenueDrinkPrices(
      "<p>Bottled beer Corona 330ml &pound;3.85 Holsten Pils 440ml &pound;3.80</p>",
    );
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toContain("bottled-measure-not-a-pint");
  });

  it("bands only categories it can be honest about, and never `other`", () => {
    const banded = Object.keys(CATEGORY_PRICE_BANDS) as DrinkCategory[];
    for (const category of banded) {
      expect(DRINK_CATEGORIES as readonly string[]).toContain(category);
    }
    expect(banded).not.toContain("other");
  });

  it("names every drop reason it can produce", () => {
    expect(new Set(UK_PRICE_DROP_REASONS).size).toBe(UK_PRICE_DROP_REASONS.length);
  });
});

describe("whether a page is a drinks list at all", () => {
  it("takes a page stating many priced lines", () => {
    expect(pageStatesADrinksList(readVenueDrinkPrices(drinksList))).toBe(true);
  });

  it("refuses a food menu, however many drink words it happens to carry", () => {
    const foodMenu = readVenueDrinkPrices(`
      <p>Crab cocktail &pound;14.90</p>
      <p>Prawn cocktail &pound;10.50</p>
      <p>Calamari lightly cooked in batter &pound;11.50</p>
      <p>Beef and ale pie, served with chips &pound;18.00</p>
      <p>Soup of the day with artisan bread &pound;8.00</p>
      <p>Draught lager pint &pound;5.80</p>`);
    expect(pageStatesADrinksList(foodMenu)).toBe(false);
  });

  it("refuses a page stating one or two, which is what a banner states", () => {
    const banner = readVenueDrinkPrices("<p>Cask ale &pound;5.50 and a glass of wine &pound;7.00</p>");
    expect(banner.kept.length).toBeLessThan(MIN_PRICED_LINES_FOR_LIST);
    expect(pageStatesADrinksList(banner)).toBe(false);
  });
});

describe("whether an estate page may speak for one pub", () => {
  it("lets a single-pub site price its own pub from any of its pages", () => {
    expect(pageMayPriceThisPub("https://thecrown.co.uk/", { name: "The Crown" }, 1)).toBe(true);
  });

  it("refuses an estate page that names no pub", () => {
    expect(pageMayPriceThisPub("https://brewersfayre.co.uk/", { name: "Loggans Moor" }, 27)).toBe(
      false,
    );
  });

  it("lets an estate page price the pub it names, article and all", () => {
    expect(
      pageMayPriceThisPub("https://chain.co.uk/pubs/loggans-moor/drinks", { name: "Loggans Moor" }, 27),
    ).toBe(true);
    expect(
      pageMayPriceThisPub("https://chain.co.uk/pubs/the-ship-inn/drinks", { name: "The Ship Inn" }, 12),
    ).toBe(true);
  });

  it("refuses a pub whose name is too short to identify anything", () => {
    expect(pageMayPriceThisPub("https://chain.co.uk/pubs/the-x/menu", { name: "The X" }, 9)).toBe(false);
  });

  it("slugs a name the way a URL would", () => {
    expect(pubNameSlug("The Queen's Head & Artichoke")).toBe("the-queens-head-and-artichoke");
  });
});

describe("which links a crawler may follow", () => {
  it("follows a same-site drinks page", () => {
    expect(isLikelyMenuUrl("/our-drinks", "https://thecrown.co.uk")).toBe(true);
  });

  it("refuses another site, however plausible the path", () => {
    expect(isLikelyMenuUrl("https://someone-else.co.uk/drinks", "https://thecrown.co.uk")).toBe(false);
  });

  it("refuses the pages nobody prices a pint on", () => {
    for (const path of [
      "/privacy-policy",
      "/gift-cards",
      "/book-a-table",
      "/blog/our-new-beer-menu",
      // A bottle shop's own price is not what a pint costs at the bar.
      "/shop/beer/",
      "/product-page/fine-english-sparkling-beer",
      // A food card is not a drinks list, whatever the word `menu` promises.
      "/lunch-menu",
      "/sunday-roast-menu",
    ]) {
      expect(isLikelyMenuUrl(path, "https://thecrown.co.uk"), path).toBe(false);
    }
  });

  it("takes the links a page states, deduplicated and capped", () => {
    const html = `
      <a href="/drinks">Drinks</a>
      <a href="/drinks#top">Drinks again</a>
      <a href="/menus/wine-list.pdf">Wine list</a>
      <a href="/privacy">Privacy</a>`;
    expect(menuLinkCandidates(html, "https://thecrown.co.uk")).toEqual([
      "https://thecrown.co.uk/drinks",
      "https://thecrown.co.uk/menus/wine-list.pdf",
    ]);
  });

  it("reads a sitemap's own locations", () => {
    expect(sitemapLocations("<url><loc>https://a.co/drinks</loc></url>")).toEqual([
      "https://a.co/drinks",
    ]);
  });
});
