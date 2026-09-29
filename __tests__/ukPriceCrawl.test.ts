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
  EMPTY_RENDER_MAX_CHARS,
  MIN_PRICED_LINES_FOR_LIST,
  UK_PRICE_DROP_REASONS,
  drinkLabelFromPriceContext,
  categoryFor,
  cheapestPerCategory,
  isLikelyMenuUrl,
  menuLinkCandidates,
  pageMayPriceThisPub,
  pageStatesADrinksList,
  pageText,
  pubNameSlug,
  readVenueDrinkPrices,
  renderLooksEmpty,
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
      { category: "beer", priceGbp: 6.2, drinkLabel: "Draught Madri pint" },
      { category: "beer", priceGbp: 6.4, drinkLabel: "Guinness pint" },
      { category: "beer", priceGbp: 6.8, drinkLabel: "Neck Oil pint" },
      { category: "gin", priceGbp: 8, drinkLabel: "Gordon's gin and tonic" },
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine 175ml" },
    ]);
  });


  it("keeps separate soft-drink labels for subtype-priced views", () => {
    const softDrinksList = `
<html><body>
  <p>Coke Zero &pound;2.50</p>
  <p>Diet Coke &pound;2.50</p>
  <p>Still water &pound;1.80</p>
  <p>Orange juice &pound;3.20</p>
</body></html>`;
    const reading = readVenueDrinkPrices(softDrinksList);
    const priced = cheapestPerCategory(reading);
    expect(priced.filter((row) => row.category === "soft-drink")).toEqual([
      { category: "soft-drink", priceGbp: 2.5, drinkLabel: "Coke Zero" },
      { category: "soft-drink", priceGbp: 2.5, drinkLabel: "Diet Coke" },
      { category: "soft-drink", priceGbp: 3.2, drinkLabel: "Orange juice" },
      { category: "soft-drink", priceGbp: 1.8, drinkLabel: "Still water" },
    ]);
    expect(drinkLabelFromPriceContext("Coke Zero £2.50", "£2.50")).toBe("Coke Zero");
  });

  it("reads a priced juice beside wine as a soft drink, without losing the wine", () => {
    // Synthetic menu using the printed Frobishers item in the committed source
    // ledger. No live page was fetched for this regression.
    const menu = `<p>House red wine 175ml £7.50</p>
      <p>Frobishers Juice (250ml) £3.00</p>
      <p>Madri pint £6.20</p>
      <p>Gordon's gin £8.00</p>`;
    const reading = readVenueDrinkPrices(menu);
    expect(pageStatesADrinksList(reading)).toBe(true);
    expect(cheapestPerCategory(reading)).toEqual([
      { category: "beer", priceGbp: 6.2, drinkLabel: "Madri pint" },
      { category: "gin", priceGbp: 8, drinkLabel: "Gordon's gin" },
      { category: "soft-drink", priceGbp: 3, drinkLabel: "Frobishers Juice (250ml)" },
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine 175ml" },
    ]);
  });

  it("keeps explicitly zero-alcohol cocktails out of alcoholic lanes", () => {
    // Synthetic menu using two printed names from the committed source ledger.
    // It proves parser association only; no live page was fetched here.
    const menu = `<p>0% Tropical Negroni Three Spirit Livener, Lyres Italian Spritz, Tanqueray 0.0% £9.00</p>
      <p>Berry Hugo 0.0% Three Spirit Livener 0.0%, Watermelon, Elderflower, Soda £8.00</p>
      <p>House Negroni £12.00</p>
      <p>Gordon's gin £8.00</p>`;
    const reading = readVenueDrinkPrices(menu);
    expect(pageStatesADrinksList(reading)).toBe(true);
    expect(cheapestPerCategory(reading)).toEqual([
      { category: "alcohol-free", priceGbp: 9, drinkLabel: "0% Tropical Negroni Three Spirit Livener, Lyres Italian Spritz, Tanqueray 0.0%" },
      { category: "alcohol-free", priceGbp: 8, drinkLabel: "Berry Hugo 0.0% Three Spirit Livener 0.0%, Watermelon, Elderflower, Soda" },
      { category: "cocktail", priceGbp: 12, drinkLabel: "House Negroni" },
      { category: "gin", priceGbp: 8, drinkLabel: "Gordon's gin" },
    ]);
  });

  it("reads a named spritz as a cocktail despite tequila in its ingredients", () => {
    // Synthetic menu using the Picante Spritz name in the source ledger.
    // It tests association, not a fresh read of the venue's page.
    const menu = `<p>Picante Spritz Altos Plata tequila, Beesou honey, green chilli, lime, soda £12.00</p>
      <p>House tequila shot £4.00</p>
      <p>House red wine 175ml £7.50</p>
      <p>Madri pint £6.20</p>`;
    const reading = readVenueDrinkPrices(menu);
    expect(pageStatesADrinksList(reading)).toBe(true);
    expect(cheapestPerCategory(reading)).toEqual([
      { category: "beer", priceGbp: 6.2, drinkLabel: "Madri pint" },
      { category: "cocktail", priceGbp: 12, drinkLabel: "Picante Spritz Altos Plata tequila, Beesou honey, green chilli, lime, soda" },
      { category: "shot", priceGbp: 4, drinkLabel: "House tequila shot" },
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine 175ml" },
    ]);
  });

  it("does not borrow a neighbouring drink category for a soda description", () => {
    // Synthetic menu using the Pineapple & Yuzu source label. Its original
    // page layout was not retained, so this proves the extractor rule only.
    const menu = `<p>House red wine 175ml £7.50</p>
      <p>Pineapple & Yuzu Pineapple, coconut, apple, yuzu, soda 86kcal £5.35</p>
      <p>Madri pint £6.20</p>
      <p>Gordon's gin £8.00</p>
      <p>Absolut vodka soda £6.50</p>`;
    const reading = readVenueDrinkPrices(menu);
    expect(cheapestPerCategory(reading)).toEqual([
      { category: "beer", priceGbp: 6.2, drinkLabel: "Madri pint" },
      { category: "gin", priceGbp: 8, drinkLabel: "Gordon's gin" },
      { category: "vodka", priceGbp: 6.5, drinkLabel: "Absolut vodka soda" },
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine 175ml" },
    ]);
    expect(reading.drops).toContain("no-category-word-nearby");
    expect(pageStatesADrinksList(reading)).toBe(true);
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

  it("takes the pint column of a half|pint table pair", () => {
    const reading = readVenueDrinkPrices("<p>Estrella Damm £4.00 | £6.80</p>");
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([6.8]);
    expect(reading.drops).toContain("half-measure-not-a-pint");
  });

  it("reads 568ml as a pint, not a bottle", () => {
    const reading = readVenueDrinkPrices("<p>Cask Bitter (568ml) £4.75</p>");
    expect(reading.kept).toEqual([expect.objectContaining({ category: "beer", priceGbp: 4.75 })]);
    expect(reading.drops).not.toContain("bottled-measure-not-a-pint");
  });

  it("names alcohol-free before beer, and a cocktail before a coffee", () => {
    expect(categoryFor("Lucky Saint alcohol-free lager")).toBe("alcohol-free");
    expect(categoryFor("Espresso martini")).toBe("cocktail");
  });

  it("knows a ginger ale is a soft drink and a measure is not a drink", () => {
    expect(categoryFor("Ginger Ale")).toBe("soft-drink");
    expect(categoryFor("Crabbies Alcoholic ginger beer 3.4%")).toBe("beer");
    expect(categoryFor("Non-alcoholic ginger beer")).toBe("alcohol-free");
    expect(
      readVenueDrinkPrices("<p>Crabbies Alcoholic ginger beer 3.4% &pound;5.00</p>").kept,
    ).toEqual([
      expect.objectContaining({
        category: "beer",
        drinkLabel: "Crabbies Alcoholic ginger beer 3.4%",
        priceGbp: 5,
      }),
    ]);
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

// An empty render is a fact about US, and the lane asks such a page again. A
// page that rendered and simply states no price is a fact about the PUB, and
// asking it twice does not change its answer.
describe("whether a rendered page came back with nothing on it", () => {
  it("calls a shell empty", () => {
    expect(renderLooksEmpty("")).toBe(true);
    expect(renderLooksEmpty("## Menus at The Ship\n\nContent has loaded")).toBe(true);
  });

  it("does not call a page that rendered and states no price empty", () => {
    const menu = `## Menus at The Ship\n\n${"### Small Plates\n\nA plate of things to share, served warm.\n\n".repeat(8)}`;
    expect(menu.length).toBeGreaterThan(EMPTY_RENDER_MAX_CHARS);
    expect(renderLooksEmpty(menu)).toBe(false);
  });

  // A SHELL CAN BE CHATTY. This is the Chef & Brewer menu page as it came back
  // three times out of three on 2026-09-04: past the length floor, and stating
  // in its own words that it has nothing on it yet.
  it("takes a page that says it is still loading at its word", () => {
    const shell = `## Menu at Fox & Hounds, Wimborne\n\nContent is loading...\n\n## Spotted something you like?\n\n${"Tuck into your favourites, book a table and enjoy the evening with us. ".repeat(6)}`;
    expect(shell.length).toBeGreaterThan(EMPTY_RENDER_MAX_CHARS);
    expect(renderLooksEmpty(shell)).toBe(true);
  });

  it("does not call a page that finished loading empty", () => {
    const menu = `## Menus at The Ship\n\nContent has loaded\n\n${"### Wine\n\nHouse red, a generous glass poured at the bar.\n\n".repeat(8)}`;
    expect(renderLooksEmpty(menu)).toBe(false);
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

// A SPIRITS LIST STATES THE SERVE, not the spirit, and one figure over two
// drinks belongs to neither. These are the two lines a Staffordshire pub's own
// drinks menu published on 2026-09-04, which reached the bundle as a £7.00
// Pepsi and a £7.25 pint before this rule existed.
describe("a figure priced over a spirit and its mixer", () => {
  const read = (text: string) => readVenueDrinkPrices(`<p>${text}</p>`);

  it("drops a serve whose nearest drink word is the mixer", () => {
    const line =
      "Dead Man's Fingers Coconut With Pepsi Max Tropical flavours and a smooth twist of coconut. £7.00 Sailor Jerry With Britvic Ginger Ale The original spiced rum.";
    expect(read(line).kept).toEqual([]);
    expect(read(line).drops).toContain("mixer-serve-not-one-drink");
  });

  it("does not read a bitter lemon mixer as a pint", () => {
    const line = "Bosford Rose Pink, soft and sweet. Try with Britvic Bitter Lemon. £7.25";
    const reading = read(line);
    expect(reading.kept.filter((row) => row.category === "beer")).toEqual([]);
  });

  it("leaves a line that names ONE drink alone", () => {
    const reading = read("Neck Oil Session IPA £6.20");
    expect(reading.kept).toHaveLength(1);
    expect(reading.kept[0]).toMatchObject({ category: "beer", priceGbp: 6.2 });
  });
});

// A NUMERIC REFERENCE IS THE CHARACTER IT NAMES. A drink word wearing one is
// invisible to every pattern here, so the line is read as if it named no drink.
describe("a page that writes its drink names as character references", () => {
  it("reads an accented wine name", () => {
    expect(categoryFor("Bosford Ros&#233; Pink 175ml &#163;7.00")).toBe("wine");
  });
});
