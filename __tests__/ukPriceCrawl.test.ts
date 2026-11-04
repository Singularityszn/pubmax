// WHAT A PUB'S OWN PAGE IS ALLOWED TO YIELD.
//
// The first run of this crawler read a Brewers Fayre banner saying
// "happy hour 2 for £9" beside the word "pint" and wrote £9 onto 27 pubs as the
// price of a beer. Every case below is one of the rules that stops that,
// written from the page text that caused it.

import { describe, expect, it } from "vitest";

import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import { dedupeSiteHarvestLedgerRows } from "@/lib/siteHarvestLedgerCore";
import {
  CATEGORY_PRICE_BANDS,
  EMPTY_RENDER_MAX_CHARS,
  MIN_PRICED_LINES_FOR_LIST,
  UK_PRICE_DROP_REASONS,
  drinkLabelFromPriceContext,
  findUkPriceCandidates,
  categoryFor,
  cheapestPerCategory,
  isLikelyMenuUrl,
  menuLinkCandidates,
  pageMayPriceThisPub,
  pageNamesAnotherBranch,
  pageStatesADrinksList,
  pageText,
  pubNameSlug,
  readVenueDrinkPrices,
  readKeylessUkPriceDecisions,
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
  it.each([
    "Guinness pint £6.20 Kernel stout £6.00 (2/3)",
    "Guinness pint £6.20 Kernel stout (2/3) £6.00",
    "Kernel stout £6.00 (2/3) Guinness pint £6.20",
    "Kernel stout (2/3) £6.00 Guinness pint £6.20",
    "Guinness pint £6.20 Kernel stout £6.00 ⅔",
    "Kernel stout £6.00 ⅔ Guinness pint £6.20",
    "Guinness pint £6.20 Kernel stout £6.00 (1/3)",
    "Kernel stout £6.00 (⅓) Guinness pint £6.20",
    "Guinness pint £6.20\n2/3 Kernel stout £6.00",
  ])("keeps a pint beside a fractional pour: %s", (row) => {
    for (const format of ["html", "text"] as const) {
      const reading = readVenueDrinkPrices(format === "html" ? `<p>${row.replace(/\n/g, "</p><p>")}</p>` : row, format);
      expect(reading.kept.map(({ priceGbp }) => priceGbp)).toEqual([6.2]);
      expect(reading.drops).toEqual(["fractional-measure-not-a-pint"]);
    }
  });

  it("keeps a useful drinks list when a neighbouring pour is fractional", () => {
    const reading = readVenueDrinkPrices(`<p>Guinness pint £6.20 Kernel stout £6.00 (2/3)</p>
      <p>Madri pint £6.40</p><p>Neck Oil pint £6.80</p><p>House red wine 175ml £7.50</p>`, "html");
    expect(reading.kept.map(({ priceGbp }) => priceGbp)).toEqual([6.2, 6.4, 6.8, 7.5]);
    expect(pageStatesADrinksList(reading)).toBe(true);
  });

  it("does not publish Small Beer fractional pours as pints or borrow their measure", () => {
    // Small Beer drinks page, read 23 October 2026. Each paragraph is one item.
    const menu = `<p>Never Come Back, Hazy IPA, 6.5%, Two Flints (Windsor) £8.60(2/3)</p>
      <p>Locals, IPA, 6%, Beak (Lewes) £7.40 (2/3)</p>
      <p>Dest, Pilsner, 5%, Beak (Lewes) £7.50</p>
      <p>Cascade, Dry Stout, 4.6%, The Kernel (Bermondsey) £6.00(2/3)</p>`;
    const reading = readVenueDrinkPrices(menu, "html");
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([7.5]);
    expect(reading.drops).toEqual(Array(3).fill("fractional-measure-not-a-pint"));
  });

  it("keeps a price-first cocktail attached to its own name", () => {
    const reading = readVenueDrinkPrices(`<p>£12 Espresso Martini</p><p>Sacred Vodka, Coffee</p>
      <p>£10 Negroni</p><p>Sacred Gin, Campari, Vermouth</p>`, "html");
    expect(reading.kept.map(({ category, priceGbp, drinkLabel }) => ({ category, priceGbp, drinkLabel }))).toEqual([
      { category: "cocktail", priceGbp: 12, drinkLabel: "Espresso Martini" },
      { category: "cocktail", priceGbp: 10, drinkLabel: "Negroni" },
    ]);
  });

  it("does not let an unknown price-first name inherit the previous cocktail's spirit", () => {
    const reading = readVenueDrinkPrices(`<p>£12 Clover Club</p><p>Sacred Gin, Lemon, Dry Vermouth</p>
      <p>£10 Topsfield Tea</p><p>Vodka, Lemon, Brewed Tea, Peach Syrup</p>
      <p>Tequila, Cointreau, Lime, Jalapeno, Tajin Rim £10 Pisco Sour</p>`, "html");
    expect(reading.kept.map(({ category, priceGbp, drinkLabel }) => ({ category, priceGbp, drinkLabel }))).toEqual([
      { category: "cocktail", priceGbp: 12, drinkLabel: "Clover Club" },
      { category: "cocktail", priceGbp: 10, drinkLabel: "Pisco Sour" },
    ]);
  });

  it("keeps the 440ml can heading with every beer until the next section", () => {
    const reading = readVenueDrinkPrices(`<p>LOW ABV (440ml Cans)</p>
      <p>Cosmic Turtle, NEIPA, 0.5%, Below Brew (Bath) £6.90</p>
      <p>Wild Juice Chase, Juicy Pale Ale, 0.5%, Below Brew (Bath) £6.90</p>
      <p>Forgot to Take my Pils, Pilsner, 0.5%, Below Brew (Bath) £6.90</p>
      <p>Draught</p><p>Guinness pint £6.20</p>`, "html");
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([6.2]);
    expect(reading.drops).toEqual(Array(3).fill("bottled-measure-not-a-pint"));
  });

  it.each(["Bottled Beers", "Bottled Beers & Ciders"])("ends %s at the captured On Draught heading", (heading) => {
    for (const format of ["text", "html"] as const) {
      const lines = [heading, "Peroni £5.50", "On Draught", "Guinness £6.20"];
      const menu = format === "text" ? lines.join("\n") : lines.map((line) => `<p>${line.replace(/&/g, "&amp;")}</p>`).join("");
      const reading = readVenueDrinkPrices(menu, format);
      expect(reading.kept.map(({ category, priceGbp }) => ({ category, priceGbp }))).toEqual([{ category: "beer", priceGbp: 6.2 }]);
      expect(reading.drops).toEqual(["bottled-measure-not-a-pint"]);
      const decisions = [...readKeylessUkPriceDecisions(menu, format).values()];
      expect(decisions.map((decision) => decision.drop ?? decision.kept?.priceGbp)).toEqual(["bottled-measure-not-a-pint", 6.2]);
    }
  });

  it.each(["On Draught", "Draught Beer", "Draught Beers", "Draft Beer", "Draft Beers", "DRAUGHT BEER"])(
    "keeps the Jolly Coopers draught rows after %s", (heading) => {
      // Items and order from the 19 October Jolly Coopers capture. Only the
      // heading varies: the captured page itself says "On Draught".
      const lines = [
        "Bottled Beers", "Budweiser 330ml £5.00", "Peroni Gluten Free 330ml £5.00",
        "Peroni 330ml £5.00", "Leffe 330ml £6.50", "Estrella Damm 330ml £5.00",
        "Heineken 00 330ml £4.50", "Bottled Ciders", "Various Flavours 568ml £7.00",
        "Canned Guiness 0.0% 568ml £5.50", heading, "Guinness £7.80", "Foster’s £6.20",
        "Heineken Export £7.50", "Birra Moretti £7.50", "Inches Cider £7.00",
        "London Lager £7.80", "Bevertown Neck Oil £7.80", "Cruzcampo Sevilla Lager £7.20",
      ];
      for (const format of ["text", "html"] as const) {
        const menu = format === "text" ? lines.join("\n") : lines.map((line) => `<p>${line}</p>`).join("");
        const reading = readVenueDrinkPrices(menu, format);
        expect(reading.kept.filter((row) => row.category === "beer").map((row) => row.priceGbp))
          .toEqual([7.8, 6.2, 7.5, 7.5, 7, 7.8, 7.8, 7.2]);
        expect(reading.drops).toHaveLength(7);
        expect(reading.kept.some((row) => row.drinkLabel?.includes("330ml"))).toBe(false);
        expect(pageStatesADrinksList(reading)).toBe(true);
        expect([...readKeylessUkPriceDecisions(menu, format).values()].filter((row) => row.kept)).toHaveLength(9);
      }
    },
  );

  it("does not label an unqualified sour style as a cocktail", () => {
    const reading = readVenueDrinkPrices(`<p>Raspberry, Apricot &amp; Lemon, Sour, 4%, Howling Hops £7.70</p>`, "html");
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toEqual(["no-category-word-nearby"]);
    expect(readVenueDrinkPrices("<p>Pisco Sour £10</p>", "html").kept[0]?.category).toBe("cocktail");
  });

  it.each(["section", "article", 'div class="menubox"'])(
    "limits wine inference to preceding headings in %s", (container) => {
      const reading = readVenueDrinkPrices(`<${container}>
        <p>Orchard Light 125ml £4.50 250ml £6.50</p>
        <div><h2>Wine</h2></div><p>Gavi de Gavi 125ml £7.00 250ml £14.00</p>
        <div><h3>Soft drinks</h3></div><p>Garden Fizz 125ml £4.00 250ml £6.00</p>
        </${container.split(" ")[0]}>`);
      expect(cheapestPerCategory(reading).filter((row) => row.category === "wine")).toEqual([
        { category: "wine", drinkLabel: "Gavi de Gavi", servingSize: "125ml", priceGbp: 7 },
        { category: "wine", drinkLabel: "Gavi de Gavi", servingSize: "250ml", priceGbp: 14 },
      ]);
      expect(pageStatesADrinksList(reading)).toBe(false);
    },
  );

  it("does not lend heading evidence to unscoped paragraphs", () => {
    const reading = readVenueDrinkPrices(`<p>Orchard Light 125ml £4.50 250ml £6.50</p>
      <h2>Wine</h2><p>Rioja 125ml £7.00 250ml £14.00</p>
      <h2>Soft drinks</h2><p>Garden Fizz 125ml £4.00 250ml £6.00</p>`);
    expect(cheapestPerCategory(reading).filter((row) => row.category === "wine")).toEqual([
      { category: "wine", drinkLabel: "Rioja", servingSize: "125ml", priceGbp: 7 },
      { category: "wine", drinkLabel: "Rioja", servingSize: "250ml", priceGbp: 14 },
    ]);
  });

  it.each(["/", "-", "\u2013", "\u2014", "|"])(
    "preserves distinct wines across %s separators and deduplication", (separator) => {
      const paragraphs = `<p>Rioja 125ml £5.25 ${separator} 250ml £10.50</p>
        <p>Chardonnay 125ml £6.50 ${separator} 250ml £13.00</p>`;
      for (const menu of [paragraphs, `<div class="menubox"><h2>Wine</h2>${paragraphs}</div>`]) {
        const rows = cheapestPerCategory(readVenueDrinkPrices(menu));
        expect(rows).toEqual([
          { category: "wine", drinkLabel: "Chardonnay", servingSize: "125ml", priceGbp: 6.5 },
          { category: "wine", drinkLabel: "Chardonnay", servingSize: "250ml", priceGbp: 13 },
          { category: "wine", drinkLabel: "Rioja", servingSize: "125ml", priceGbp: 5.25 },
          { category: "wine", drinkLabel: "Rioja", servingSize: "250ml", priceGbp: 10.5 },
        ]);
        const ledger = dedupeSiteHarvestLedgerRows(rows.map((row) => ({
          ...row, venueId: "venue-uk-n1", observedAt: "2026-09-29T10:40:17.846Z",
        })), new Map());
        expect(ledger).toHaveLength(4);
        expect(ledger.filter((row) => row.servingSize === "250ml").map((row) => row.priceGbp))
          .toEqual([13, 10.5]);
      }
      const split = readVenueDrinkPrices(`<p>Rioja 125ml £5.25</p><p>${separator} 250ml £10.50</p>`);
      expect(split.kept.some((row) => row.priceGbp === 10.5)).toBe(false);
    },
  );

  it.each([
    ["4.0%", "beer"], ["10.0%", "beer"], ["0.5%", "beer"],
    ["0%", "alcohol-free"], ["0.0%", "alcohol-free"], ["0.00%", "alcohol-free"],
    ["alcohol-free", "alcohol-free"],
  ])("classifies complete strength token %s as %s", (strength, category) => {
    for (const name of ["Shenanigans Lager", "Guinness", "Heineken"]) {
      const reading = readVenueDrinkPrices(`<p>${name} ${strength} £3.70</p>`);
      expect(reading.kept).toEqual([
        expect.objectContaining({ category, priceGbp: 3.7 }),
      ]);
    }
  });

  it.each(["alcohol-free lager", "alcohol free lager", "non-alcoholic lager"])(
    "keeps explicit %s while refusing free-drink promotions", (label) => {
      expect(readVenueDrinkPrices(`<p>${label} £3.70</p>`).kept).toEqual([
        expect.objectContaining({ category: "alcohol-free", priceGbp: 3.7 }),
      ]);
      expect(readVenueDrinkPrices(`<p>${label} £3.70 with free crisps</p>`).kept).toEqual([]);
    },
  );

  it("preserves price offsets when retaining structural boundaries", () => {
    const menu = `<section><h2>Wine</h2><p>Rioja<br />125ml £5.25 250ml £10.50</p></section>
      <div><p>Gordon's gin £8.00</p></div>`;
    expect(findUkPriceCandidates(pageText(menu, true)).map((row) => row.at))
      .toEqual(findUkPriceCandidates(pageText(menu)).map((row) => row.at));
  });

  it.each([
    "<p>Rioja 125ml £5.25 250ml £10.50</p><p>Gordon's gin £8.00</p>",
    "Rioja 125ml £5.25 250ml £10.50 Gordon's gin £8.00",
  ])("keeps paired wine measures before following gin: %s", (menu) => {
    const reading = readVenueDrinkPrices(menu);
    expect(reading.kept.map(({ category, drinkLabel, servingSize, priceGbp }) => (
      { category, drinkLabel, servingSize, priceGbp }
    ))).toEqual([
      { category: "wine", drinkLabel: "Rioja", servingSize: "125ml", priceGbp: 5.25 },
      { category: "wine", drinkLabel: "Rioja", servingSize: "250ml", priceGbp: 10.5 },
      { category: "gin", drinkLabel: "Gordon's gin", servingSize: undefined, priceGbp: 8 },
    ]);
  });

  it.each(["p", "li", "div", "section", "article", "tr"])(
    "does not join wine measures across separate %s items", (tag) => {
      const item = (text: string) => tag === "tr" ? `<tr><td>${text}</td></tr>` : `<${tag}>${text}</${tag}>`;
      for (const size of ["125ml", "175ml", "250ml"]) {
        const body = `${item("Rioja 125ml £5.25")}${item(`${size} £10.50`)}${item("Gordon's gin £8.00")}`;
        const reading = readVenueDrinkPrices(tag === "tr" ? `<table>${body}</table>` : body);
        expect(reading.kept.filter((row) => row.priceGbp === 10.5)).toEqual([]);
        expect(reading.kept.find((row) => row.priceGbp === 5.25)).toMatchObject({
          category: "wine", drinkLabel: "Rioja", servingSize: "125ml",
        });
      }
    },
  );

  it("reads the text a reader sees and drops what a script says", () => {
    const text = pageText('<script>var p = "£4.00";</script><p>Madri pint &pound;6.20</p>');
    expect(text).toBe("Madri pint £6.20");
  });

  it("keeps a stated price per drink and names its category", () => {
    const reading = readVenueDrinkPrices(drinksList);
    expect(cheapestPerCategory(reading)).toEqual([
      { category: "beer", priceGbp: 6.4, drinkLabel: "Guinness pint" },
      { category: "beer", priceGbp: 6.2, drinkLabel: "Madri pint" },
      { category: "beer", priceGbp: 6.8, drinkLabel: "Neck Oil pint" },
      { category: "gin", priceGbp: 8, drinkLabel: "Gordon's gin and tonic" },
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine", servingSize: "175ml" },
    ]);
  });

  it("keeps each explicitly priced Sydney Arms wine glass with its own name and measure", () => {
    // Minimal excerpt of the permission-checked 29 Sep menu capture. Btl has
    // no stated volume and its price is outside the glass-wine band.
    const menu = `<p>Chardonnay, Pays D&#8217;oc, France<br />
125ml £5.50 250ml £11.00 Btl £31.50</p>
<p>Rioja, Spain<br />
125ml £5.25 250ml £10.50 Btl £30.00</p>`;
    const rows = cheapestPerCategory(readVenueDrinkPrices(menu));
    expect(rows.filter((row) => row.category === "wine")).toEqual([
      { category: "wine", priceGbp: 5.5, drinkLabel: "Chardonnay, Pays D’oc, France", servingSize: "125ml" },
      { category: "wine", priceGbp: 11, drinkLabel: "Chardonnay, Pays D’oc, France", servingSize: "250ml" },
      { category: "wine", priceGbp: 5.25, drinkLabel: "Rioja, Spain", servingSize: "125ml" },
      { category: "wine", priceGbp: 10.5, drinkLabel: "Rioja, Spain", servingSize: "250ml" },
    ]);
    expect(rows.some((row) => row.servingSize === "Btl" || row.servingSize === "750ml")).toBe(false);
  });

  it("uses wine section headings for named glass pairs without lending them to sibling sections", () => {
    // Excerpts from the permission-checked Sydney Arms capture, with adjacent
    // non-wine sections to pin the section boundary.
    const menu = `<div class="menubox"><div class="title"><h1>white</h1></div>
      <p>Gavi de Gavi, Italy<br />125ml £7.00 250ml £14.00 Btl £39.95</p></div>
      <div class="menubox"><div class="title"><h1>red</h1></div>
      <p>Faithful Hound, South Africa<br />125ml £7.00 250ml £14.00 Btl £39.95</p></div>
      <div class="menubox"><div class="title"><h1>rosé</h1></div>
      <p>Côtes de Provence, France<br />125ml £6.50 250ml £13.00 Btl £37.50</p></div>
      <div class="menubox"><div class="title"><h1>soft drinks</h1></div>
      <p>Garden Fizz<br />125ml £2.50 250ml £4.00</p></div>
      <div class="menubox"><div class="title"><h1>no alcohol</h1></div>
      <p>Orchard Light<br />125ml £4.00 250ml £6.00</p></div>
      <div class="menubox"><div class="title"><h1>cocktails</h1></div>
      <p>Evening Bloom<br />125ml £8.00 250ml £12.00</p></div>`;
    const reading = readVenueDrinkPrices(menu);
    const wine = cheapestPerCategory(reading).filter((row) => row.category === "wine");
    expect(wine).toEqual([
      { category: "wine", priceGbp: 6.5, drinkLabel: "Côtes de Provence, France", servingSize: "125ml" },
      { category: "wine", priceGbp: 13, drinkLabel: "Côtes de Provence, France", servingSize: "250ml" },
      { category: "wine", priceGbp: 7, drinkLabel: "Faithful Hound, South Africa", servingSize: "125ml" },
      { category: "wine", priceGbp: 14, drinkLabel: "Faithful Hound, South Africa", servingSize: "250ml" },
      { category: "wine", priceGbp: 7, drinkLabel: "Gavi de Gavi, Italy", servingSize: "125ml" },
      { category: "wine", priceGbp: 14, drinkLabel: "Gavi de Gavi, Italy", servingSize: "250ml" },
    ]);
    expect(wine.some((row) => /Garden Fizz|Orchard Light|Evening Bloom/.test(row.drinkLabel ?? ""))).toBe(false);
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

  it("drops an inline price list's separator from the front of each later item", () => {
    // Printed on https://jollycoopers.co.uk/menu, read 2026-10-17.
    const line = "Cans (Coke £3.30, Coke Zero £3, Fanta Orange Zero £3, Sprite Zero £3)";
    const at = (needle: string) => line.indexOf(needle) + needle.length + 1;
    expect(drinkLabelFromPriceContext(line, "£3", at("Coke Zero"))).toBe("Coke Zero");
    expect(drinkLabelFromPriceContext(line, "£3", at("Sprite Zero"))).toBe("Sprite Zero");
    // A comma inside a name is the name, not a separator.
    expect(drinkLabelFromPriceContext("Coca Cola,Diet Coke,Schweppes Lemonade £3.85", "£3.85"))
      .toBe("Coca Cola,Diet Coke,Schweppes Lemonade");
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
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine", servingSize: "175ml" },
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
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine", servingSize: "175ml" },
    ]);
  });

  it.each([
    ["a cocktail description on the same line", "<p>Hugo £9 Elderflower spritz, prosecco, mint Guinness £5.90</p>", 5.9, "beer"],
    ["a zero-strength description on the same line", "<p>Lucky Saint £5.20 0% unfiltered lager Guinness £5.90</p>", 5.9, "beer"],
    ["a sour beer style", "<ul><li>Brewdog Sour IPA £6.50</li></ul>", 6.5, "beer"],
    ["a sour ale", "<ul><li>Wild Sour Ale £6.20</li></ul>", 6.2, "beer"],
    ["a zero-strength item name", "<ul><li>Heineken 0.0% lager £5.00</li></ul>", 5, "alcohol-free"],
    ["an HTML item formatted across source lines", "<ul><li>Negroni\non tap £9.00</li></ul>", 9, "cocktail"],
    ["an inline HTML item formatted across source lines", "<span>Espresso Martini\non draught £9.50</span>", 9.5, "cocktail"],
    ["an HTML table cell formatted across source lines", "<td>Espresso Martini\non draught £9.50</td>", 9.5, "cocktail"],
    ["adjacent inline HTML elements on separate source lines", "<span>Espresso Martini</span>\n<span>on draught £9.50</span>", 9.5, "cocktail"],
    ["a cocktail served on tap", "<ul><li>Negroni on tap £9.00</li></ul>", 9, "cocktail"],
    ["a cocktail served on draught", "<ul><li>Espresso Martini on draught £9.50</li></ul>", 9.5, "cocktail"],
    ["a cocktail naming a beer brand in its description", "<ul><li>Espresso Martini Vodka, Kahlua, Camden coffee £9.50</li></ul>", 9.5, "cocktail"],
    ["a heading that agrees with the item", "<h2>Alcohol-free</h2><ul><li>Lucky Saint £5.20</li></ul>", 5.2, "alcohol-free"],
  ])("reads %s from the printed item name", (_case, menu, priceGbp, category) => {
    expect(readVenueDrinkPrices(menu).kept.find((row) => row.priceGbp === priceGbp)?.category).toBe(category);
  });

  it.each([
    ["a cocktail heading above a beer", "<h2>Spritz Season</h2><ul><li>Camden Hells £6.50</li></ul>", 6.5],
    ["a zero-strength heading above a beer", "<h2>0% on the bar</h2><ul><li>Camden Hells £6.50</li></ul>", 6.5],
    ["a cocktail description above the next beer", "<ul><li>Hugo £9</li><li>Elderflower spritz, prosecco, mint</li><li>Guinness £5.90</li></ul>", 5.9],
    ["a zero-strength description above the next beer", "<ul><li>Lucky Saint £5.20</li><li>0% unfiltered lager</li><li>Guinness £5.90</li></ul>", 5.9],
    ["a zero-strength name above its own description", "<div><h4>Lucky Saint 0%</h4><p>Unfiltered lager £5.20</p></div>", 5.2],
    ["a cocktail name above its own description", "<h4>Picante Spritz</h4><p>Altos Plata tequila, Beesou honey, green chilli, lime, soda £12.00</p>", 12],
  ])("refuses a figure whose printed name is ambiguous after %s", (_case, menu, priceGbp) => {
    const reading = readVenueDrinkPrices(menu);
    expect(reading.kept.find((row) => row.priceGbp === priceGbp)).toBeUndefined();
    expect(reading.drops).toContain("item-name-ambiguous");
  });

  it("refuses a spirit-and-juice serve as a soft-drink price", () => {
    const reading = readVenueDrinkPrices("<ul><li>Vodka Cranberry Juice £6.50</li></ul>");
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toEqual(["mixer-serve-not-one-drink"]);
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
      { category: "wine", priceGbp: 7.5, drinkLabel: "House red wine", servingSize: "175ml" },
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

  it("takes the pint of a bare pair under Half and Pint column heads", () => {
    const reading = readVenueDrinkPrices(
      "<p>Draught Half Pint Peroni 5.0% &pound;3.90 &pound;7.70 Carling 4.0% &pound;3.60 &pound;7.20 Jubel 4.0% &pound;4.10 &pound;8.00</p>",
    );
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([7.7, 7.2, 8]);
    expect(reading.drops.filter((reason) => reason === "half-measure-not-a-pint")).toHaveLength(3);
  });

  it("drops a figure written as a 1/2 pint when the line never says half", () => {
    const reading = readVenueDrinkPrices(
      "<p>Paulaner Lager Helles 4.9% 1/2 Pint &pound;4.05 Sierra Nevada IPA 4.2% 1/2 Pint &pound;4.20 Pint &pound;6.50</p>",
    );
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([6.5]);
    expect(reading.drops.filter((reason) => reason === "half-measure-not-a-pint")).toHaveLength(2);
  });

  it("keeps two neighbouring pints that are not a half and its pint", () => {
    const reading = readVenueDrinkPrices("<p>Draught beer Peroni &pound;6.50 Camden Hells lager &pound;6.90</p>");
    expect(reading.kept.map((row) => row.priceGbp)).toEqual([6.5, 6.9]);
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

  it("files matcha as coffee and leaves tea lines out of it", () => {
    expect(categoryFor("Matcha latte")).toBe("coffee");
    expect(categoryFor("Matcha")).toBe("coffee");
    expect(categoryFor("Latte")).toBe("coffee");
    expect(categoryFor("Chai latte")).toBeNull();
    expect(categoryFor("Tea latte")).toBeNull();
    expect(readVenueDrinkPrices("<p>Matcha latte £4.20</p>").kept).toEqual([
      expect.objectContaining({ category: "coffee", priceGbp: 4.2 }),
    ]);
    expect(readVenueDrinkPrices("<p>Chai latte £4.20</p>").kept).toEqual([]);
    // A named tea after a matcha or espresso line must not borrow its category.
    for (const above of ["Matcha £3.60", "Espresso £2.80"]) {
      expect(
        readVenueDrinkPrices(`<p>${above}</p>\n<p>Earl Grey tea £2.50</p>`).kept.map((row) => row.priceGbp),
      ).toEqual([Number(above.slice(-4))]);
    }
  });

  it("never files a chai latte under the drink on the line above", () => {
    const chaiRows = (html: string) =>
      readVenueDrinkPrices(html).kept.filter((row) => row.priceGbp === 3.9);
    expect(chaiRows("<p>Pint of Camden Hells £6.50</p><p>Chai latte £3.90</p>")).toEqual([]);
    expect(chaiRows("<p>House red wine 175ml £7.50</p><p>Chai latte £3.90</p>")).toEqual([]);
    expect(chaiRows("<p>Latte £3.40</p><p>Chai latte £3.90</p><p>Flat white £3.30</p>")).toEqual([]);
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

// A HOST WITH ONE MATCHED PUB IS NOT A HOST WITH ONE PUB. Both cases were found
// on 1 Nov 2026, each on a host the snapshot gave one pub.
describe("whether a page names another branch of the pub's chain", () => {
  const botanist = {
    name: "The Botanist Gas Street Basin",
    locality: "Birmingham",
    address: "12, Bridge Street, Birmingham, B1 2JR",
    website: "https://thebotanist.uk.com/locations/gas-street-basin-birmingham",
  };
  const simmons = {
    name: "Simmons",
    locality: "London",
    address: "7, Camden High Street, London, NW1 7JE",
    website: "https://www.simmonsbar.co.uk/",
  };

  it("refuses the Barnsley page for the Birmingham Botanist, though the host has one pub", () => {
    const page = "https://thebotanist.uk.com/locations/barnsley/whats-on";
    expect(pageNamesAnotherBranch(page, botanist)).toBe(true);
    expect(pageMayPriceThisPub(page, botanist, 1)).toBe(false);
    expect(pageMayPriceThisPub(page, { name: botanist.name }, 1)).toBe(false);
  });

  it("refuses the Shoreditch page for Simmons in Camden, though the host has one pub", () => {
    const page = "https://www.simmonsbar.co.uk/venues/shoreditch-cocktail-bar/";
    expect(pageNamesAnotherBranch(page, simmons)).toBe(true);
    expect(pageMayPriceThisPub(page, simmons, 1)).toBe(false);
    expect(pageMayPriceThisPub(page, { name: simmons.name }, 1)).toBe(false);
  });

  it("lets a pub's own branch page, or a page naming its town, price it", () => {
    expect(pageMayPriceThisPub("https://thebotanist.uk.com/locations/gas-street-basin-birmingham/drinks", botanist, 1)).toBe(true);
    expect(pageMayPriceThisPub("https://thebotanist.uk.com/locations/birmingham/menus", botanist, 1)).toBe(true);
    expect(pageMayPriceThisPub("https://www.simmonsbar.co.uk/venues/camden/", simmons, 1)).toBe(true);
  });

  it("lets a page that names no branch keep the pub-count answer", () => {
    expect(pageMayPriceThisPub("https://www.simmonsbar.co.uk", simmons, 1)).toBe(true);
    expect(pageMayPriceThisPub("https://www.simmonsbar.co.uk/locations/", simmons, 1)).toBe(true);
    expect(pageMayPriceThisPub("https://thebotanist.uk.com/locations/whats-on", botanist, 1)).toBe(true);
    // A singular `bar` is a pub site's own drinks section, not a branch.
    expect(pageMayPriceThisPub("https://www.thebluemonklondon.com/bar/wine-list", { name: "The Blue Monk" }, 1)).toBe(true);
  });

  it("reads a county-first chain path by the pub it names, however the URL spells it", () => {
    expect(pageNamesAnotherBranch("https://www.greeneking.co.uk/pubs/mid-glamorgan/court-house/menu", { name: "The Courthouse" })).toBe(false);
    expect(pageNamesAnotherBranch("https://www.greeneking.co.uk/pubs/lancashire/taps/menu", { name: "The Taps" })).toBe(false);
    expect(pageNamesAnotherBranch("https://www.greeneking.co.uk/pubs/somerset/saracens-head/menu", { name: "Saracen's Head Tavern" })).toBe(false);
    expect(pageNamesAnotherBranch("https://www.greeneking.co.uk/pubs/kent/compasses/menu", { name: "The Granta" })).toBe(true);
  });

  it("still holds an estate page to the pub it names", () => {
    expect(pageMayPriceThisPub("https://chain.co.uk/pubs/loggans-moor/drinks", { name: "Loggans Moor" }, 27)).toBe(true);
    expect(pageMayPriceThisPub("https://chain.co.uk/pubs/the-ship-inn/drinks", { name: "Loggans Moor" }, 27)).toBe(false);
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

describe("a long wine list", () => {
  it("prices every glass in one pass", () => {
    const count = 400;
    const sections = Array.from({ length: count }, (_, index) => {
      const pounds = (4 + (index % 10) + (index % 3) / 100).toFixed(2);
      return `<section><h2>Wine</h2><p>House red ${index} 175ml £${pounds}</p></section>`;
    });
    const html = `<p>Madri pint £6.20</p>${sections.join("")}`;
    const reading = readVenueDrinkPrices(html);
    const wines = reading.kept.filter((row) => row.category === "wine");
    expect(wines).toHaveLength(count);
    expect(wines[0]).toMatchObject({ drinkLabel: expect.stringContaining("House red 0") });
    expect(wines[count - 1]).toMatchObject({
      drinkLabel: expect.stringContaining(`House red ${count - 1}`),
    });
    expect(reading.kept.some((row) => row.category === "beer" && row.priceGbp === 6.2)).toBe(true);
  });
});

// A rendered page reaches the reader as Markdown. The Lvls drinks page, read
// through the rendered lane on 2026-10-17, stored "#### Coke / Diet Coke 330ml
// glass bottle" beside the document lane's "Coke / Diet Coke 330ml glass bottle",
// and a Stratford pub's event banner was read out of its own link syntax.
describe("a page that reaches the reader as Markdown", () => {
  const menu = `### SOFT DRINKS

#### Coke / Diet Coke 330ml glass bottle

£3.50

#### Fentimans Ginger Beer

**£3.80**

#### J2O Apple \\& Mango

£3.20

#### [Seedlip Garden](https://example.pub/seedlip) and tonic

£6.50

[![£6 Margarita Monday](https://example.pub/banner.jpg)](https://example.pub/whats-on/6-margarita-monday/)
`;

  it("names each drink by its words, not its heading, emphasis, escape or link marks", () => {
    const reading = readVenueDrinkPrices(menu);
    expect(pageStatesADrinksList(reading)).toBe(true);
    expect(reading.kept.map((row) => [row.drinkLabel, row.priceGbp])).toEqual(
      expect.arrayContaining([
        // The section heading leads the first item, as it does on a served page.
        ["SOFT DRINKS Coke / Diet Coke 330ml glass bottle", 3.5],
        ["Fentimans Ginger Beer", 3.8],
        ["J2O Apple & Mango", 3.2],
      ]),
    );
    for (const row of reading.kept) {
      expect(row.drinkLabel ?? "").not.toMatch(/[#*\\[\]]|\]\(|https?:/);
    }
  });

  it("reads an image as no words at all, so its alt text states no price", () => {
    expect(pageText(menu)).not.toContain("Margarita");
    expect(pageText(menu)).toContain("Seedlip Garden and tonic");
    expect(readVenueDrinkPrices(menu).kept.some((row) => row.priceGbp === 6)).toBe(false);
  });

  it("keeps the same label a served HTML page states for the same line", () => {
    const html = "<h4>Coke / Diet Coke 330ml glass bottle</h4><p>£3.50</p>";
    const markdown = "#### Coke / Diet Coke 330ml glass bottle\n\n£3.50";
    const label = (text: string, format: "html" | "text") =>
      readVenueDrinkPrices(text, format).kept[0]?.drinkLabel;
    expect(label(markdown, "text")).toBe("Coke / Diet Coke 330ml glass bottle");
    expect(label(markdown, "text")).toBe(label(html, "html"));
  });

  it("leaves a served HTML page's own hash and bracket text alone", () => {
    expect(pageText("<p>Pint #2 [house] £5.50</p>", false, "html")).toBe("Pint #2 [house] £5.50");
  });
});
