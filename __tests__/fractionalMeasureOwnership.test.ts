import { describe, expect, it } from "vitest";

import { readChainPintPrices } from "@/lib/harvest/chainMenuPrices";
import { factsFromPage } from "@/lib/harvest/tavilyNightlyPass";
import {
  decideKeylessUkPriceCandidate,
  findUkPriceCandidates,
  pageText,
  printedPageText,
  printedPriceLayout,
  readKeylessUkPriceDecisions,
  readVenueDrinkPrices,
} from "@/lib/harvest/ukPriceCrawl";

const fact = { sourceUrl: "https://example.test/drink-menu.html", seenOn: "2026-10-23" };
const pint = { drink: "Guinness", size: "pint", sizeDetail: "pint", priceGbp: 6.2, standing: "listed", ...fact };
const pintRow = { drinkLabel: "Guinness pint", category: "beer", priceGbp: 6.2 };
const thirds = [
  ["1/3", "one-third"], ["1 / 3", "one-third"], ["⅓", "one-third"],
  ["one-third", "one-third"], ["one third", "one-third"],
  ["2/3", "two-thirds"], ["2 / 3", "two-thirds"], ["⅔", "two-thirds"],
  ["two-thirds", "two-thirds"], ["two thirds", "two-thirds"],
] as const;

describe("fraction ownership at printed item boundaries", () => {
  it.each(thirds)("binds the explicit %s serving to its own item", (measure, sizeDetail) => {
    const partial = { drink: "Kernel stout", size: "unstated", sizeDetail, priceGbp: 6, standing: "listed", ...fact };
    const prefix = `Guinness pint £6.2;(${measure} pint) Kernel stout £6.00`;
    const suffix = `Kernel stout £6.0 (${measure} pint)•Guinness pint £6.20`;
    for (const text of [prefix, suffix]) {
      const html = `<p>${text}</p>`;
      expect(readVenueDrinkPrices(text).kept, text).toMatchObject([pintRow]);
      expect(readVenueDrinkPrices(html, "html").kept, text).toMatchObject([pintRow]);
      expect(readChainPintPrices(html).kept, text).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    }
    expect(factsFromPage(prefix, fact).drinks).toEqual([pint, partial]);
    expect(factsFromPage(suffix, fact).drinks).toEqual([partial, pint]);
  });

  it.each([",", ".", ";", ":", "|", "•", "·", "!", "?", " - "])(
    "keeps a bare suffix on its own side of %s without listing it in Tavily",
    (separator) => {
      const text = `Kernel stout £6.00 (2/3)${separator}Guinness pint £6.20`;
      expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
      expect(factsFromPage(text, fact).drinks).toEqual([pint]);
    },
  );

  it.each([
    "Guinness pint £6.20 (2/3) Kernel stout £6.00",
    "Guinness pint £6.20 (2/3 pint Kernel stout) £6.00",
    "Guinness pint £6.20 (2/3 pint) £6.00",
    "Kernel stout £6.00 (2/3) Guinness pint £6.20",
  ])("withholds the disputed figure beside an independently printed pint: %s", (text) => {
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(factsFromPage(text, fact).drinks).toEqual([pint]);
  });

  it.each(["⅔pint", "2/3pint"])("keeps joined %s and the next full pint separate", (serving) => {
    const text = `Kernel stout £6.00 ${serving}; Guinness pint £6.20`;
    const html = `<p>${text}</p>`;
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(text, fact).drinks).toEqual([
      { drink: "Kernel stout", size: "unstated", sizeDetail: "two-thirds", priceGbp: 6, standing: "listed", ...fact },
      pint,
    ]);
  });

  it("keeps a separately stated trailing pint measure", () => {
    const text = "Kernel stout £6.00 (2/3) Guinness £6.20 pint";
    expect(readVenueDrinkPrices(text).kept).toMatchObject([{ ...pintRow, drinkLabel: "Guinness" }]);
    expect(factsFromPage(text, fact).drinks).toEqual([pint]);
  });

  it.each([
    "Kernel stout £6.00 (2/3) Guinness £6.20",
    "Kernel stout £6.00 (2/3);£6.20",
  ])("withholds both figures when neither item has an independent measure: %s", (text) => {
    expect(readVenueDrinkPrices(text).kept).toEqual([]);
    expect(factsFromPage(text, fact).drinks).toEqual([]);
  });

  it("keeps a leading fraction on its original line or HTML block", () => {
    const first = "Guinness pint £6.20";
    const second = "2/3 pint Kernel stout £6.00";
    const text = `${first}\n${second}`;
    const html = `<p>${first}</p><p>${second}</p>`;
    const partial = { drink: "Kernel stout", size: "unstated", sizeDetail: "two-thirds", priceGbp: 6, standing: "listed", ...fact };
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(factsFromPage(text, fact).drinks).toEqual([pint, partial]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint, partial]);
  });

  it.each(["<br>", "<BR />", '<br class="menu-break">'])(
    "keeps two items on separate visible lines across %s",
    (separator) => {
      const html = `<p>Guinness pint £6.20${separator}⅔pint Kernel stout £6.00</p>`;
      expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
      expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
      expect(factsFromPage(html, fact).drinks).toEqual([
        pint,
        { drink: "Kernel stout", size: "unstated", sizeDetail: "two-thirds", priceGbp: 6, standing: "listed", ...fact },
      ]);
    },
  );

  it("refuses a wrapped fraction without losing a separate named pint", () => {
    const text = ["Peroni £4.50", "(1/3 pint)", "Guinness pint £6.20"].join("\n");
    const html = "<p>Peroni £4.50<br>(1/3 pint)<br>Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it("withholds a bare parenthesised fraction wrapped inside its priced item", () => {
    const text = ["Peroni £4.50", "(2/3)", "Guinness £6.20 /pint"].join("\n");
    const html = "<p>Peroni £4.50<br>(2/3)</p><p>Guinness £6.20 /pint</p>";
    expect(readVenueDrinkPrices(text).kept).toMatchObject([{ ...pintRow, drinkLabel: "Guinness" }]);
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([{ ...pintRow, drinkLabel: "Guinness" }]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it("keeps trailing pint evidence beside a standalone wrapped fraction", () => {
    const text = ["Peroni £4.50", "(1/3 pint)", "Guinness £6.20 /pint"].join("\n");
    expect(readVenueDrinkPrices(text).kept).toMatchObject([{ ...pintRow, drinkLabel: "Guinness" }]);
    expect(factsFromPage(text, fact).drinks).toEqual([pint]);
  });

  it.each([
    "<p>Guinness pint £6.20</p><p>(1/3 pint)</p><p>Madri pint £6.40</p>",
    "<p>Guinness pint £6.20<br>(1/3 pint)<br>Madri pint £6.40</p>",
  ])("keeps both named pints around an unbound fraction: %s", (html) => {
    const expected = [pintRow, { drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 }];
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject(expected);
    expect(readChainPintPrices(html).kept).toMatchObject([
      { drinkLabel: "Guinness pint", priceGbp: 6.2 }, { drinkLabel: "Madri pint", priceGbp: 6.4 },
    ]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint, { ...pint, drink: "Madri", priceGbp: 6.4 }]);
    const prices = findUkPriceCandidates(pageText(html, true, "html"));
    expect([...readKeylessUkPriceDecisions(html, "html").keys()]).toEqual(prices.map(({ at }) => at));
  });

  it("does not borrow a fractional measure from a separate paragraph", () => {
    const html = "<p>Guinness pint £6.20</p><p>(1/3 pint)</p>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
    const wrapped = "<p>Guinness pint £6.20<br>(1/3 pint)</p>";
    expect(readVenueDrinkPrices(wrapped, "html").kept).toEqual([]);
    expect(readChainPintPrices(wrapped).kept).toEqual([]);
    expect(factsFromPage(wrapped, fact).drinks).toEqual([]);
  });

  it.each(["Pub T-shirt", "Guinness T-shirt", "Pint glass", "Souvenir keyring"])(
    "does not make the price of %s a competing drink",
    (merchandise) => {
      const html = `<p>Guinness pint £6.20<br>(1/3 pint)<br>${merchandise} £8.00</p>`;
      expect(readVenueDrinkPrices(html, "html").kept).toEqual([]);
      expect(readChainPintPrices(html).kept).toEqual([]);
      expect(factsFromPage(html, fact).drinks).toEqual([]);
    },
  );

  it("keeps a named competing drink as evidence beside the unbound fraction", () => {
    const html = "<p>Guinness pint £6.20<br>(1/3 pint)<br>Madri £6.40</p>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it.each([
    "<p>Guinness pint £6.20</p><p>(1/3 pint)</p><p>Hawkstone pint £6.40</p>",
    "<p>Guinness pint £6.20<br>(1/3 pint)<br>Hawkstone pint £6.40</p>",
  ])("keeps a named pint when its category comes from the menu context: %s", (html) => {
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([
      pintRow, { ...pintRow, drinkLabel: "Hawkstone pint", priceGbp: 6.4 },
    ]);
  });

  it("keeps a separate block quote from qualifying a pint", () => {
    const html = "<blockquote>Guinness pint £6.20</blockquote><blockquote>(1/3 pint)</blockquote>";
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
  });

  it("withholds a wrapped bare fraction even when its price uses a trailing pint unit", () => {
    const html = "<p>Guinness £6.20 /pint<br>(2/3)</p><p>Madri pint £6.40</p>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([
      { ...pintRow, drinkLabel: "Madri pint", priceGbp: 6.4 },
    ]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Madri pint", priceGbp: 6.4 }]);
  });

  it("keeps a price-first wrapped fraction with the item it qualifies", () => {
    const wrapped = "<p>£4.50 Peroni<br>(2/3)</p><p>Guinness pint £6.20</p>";
    const separate = "<p>£4.50 Peroni</p><p>(2/3)</p><p>Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(wrapped, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(wrapped).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(readVenueDrinkPrices(separate, "html").kept).toMatchObject([
      { ...pintRow, drinkLabel: "Peroni", priceGbp: 4.5 },
      pintRow,
    ]);
  });

  it("withholds a mixed third stated after a price", () => {
    const text = "Peroni £5.20 1 and 2/3 pint";
    expect(readVenueDrinkPrices(text).kept).toEqual([]);
    expect(readChainPintPrices(`<p>${text}</p>`).kept).toEqual([]);
    expect(factsFromPage(text, fact).drinks).toEqual([]);
  });

  it("keeps the independently measured pint before a wrapped ambiguous fraction", () => {
    const text = ["Guinness pint £6.20", "(1/3 pint)", "Kernel stout £4.50"].join("\n");
    const html = "<p>Guinness pint £6.20<br>(1/3 pint)<br>Kernel stout £4.50</p>";
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it.each([
    ["Guinness", "1/3 pint", "£4.50"].join("\n"),
    "Guinness £4.50 1/3-pint",
    "Guinness £4.50 (1/3 pint, cask)",
  ])("does not publish a wrapped or compound fractional serving: %s", (text) => {
    expect(readVenueDrinkPrices(text).kept).toEqual([]);
  });

  it.each([
    "1/3 off Peroni pint £5.20",
    "Peroni pint 1/3 off £5.20",
    "Peroni pint £5.20 1/3 off",
    "1/3 discount on Peroni pint £5.20",
    "Peroni pint £5.20 (1/3) discount",
    "Peroni pint £5.20 1/3 off draught",
    "Peroni pint £5.20, 2/3 discount",
    "Peroni pint £5.20: 2/3 discount",
    "Peroni pint £5.20, members get 2/3 discount",
    "Peroni pint £5.20: St. Patrick’s Day 2/3 discount",
    "Peroni pint £5.20: members get a 2/3 discount offer",
  ])("isolates an adjacent pint from %s", (offer) => {
    const plainPint = "Guinness pint £6.20";
    for (const text of [`${offer};${plainPint}`, `${plainPint};${offer}`]) {
      expect(readVenueDrinkPrices(text).kept, text).toMatchObject([pintRow]);
      expect(readChainPintPrices(`<p>${text}</p>`).kept, text)
        .toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
      expect(factsFromPage(text, fact).drinks, text).toEqual([pint]);
    }
  });

  it.each([
    "Guinness pint £6.20, Peroni pint 2/3 off: £5.20",
    "Guinness pint £6.20|Peroni pint 2/3 off: £5.20",
    "Peroni pint £5.20, members get 2/3 discount|Guinness pint £6.20",
  ])("keeps a strong separator or a named next item in %s", (text) => {
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(`<p>${text}</p>`).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(text, fact).drinks).toEqual([pint]);
  });

  it.each(["; ", "|"])("keeps a pint after a suffix offer and a prefix offer separated by %s", (separator) => {
    const text = ["Peroni pint £5.20 2/3 off", "Madri pint 1/3 off £4.40", "Guinness pint £6.20"].join(separator);
    expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(`<p>${text}</p>`).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(text, fact).drinks).toEqual([pint]);
  });

  it("does not build an offer cue from two separate HTML blocks", () => {
    const html = "<p>Guinness pint £6.20</p><p>2/3</p><p>off</p>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it.each([".", ". ", ","])(
    "keeps the named pint after a qualified offer closed by %s",
    (separator) => {
      const text = `Peroni pint £5.20 1/3 off draught${separator}Guinness pint £6.20`;
      expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
      expect(readChainPintPrices(`<p>${text}</p>`).kept)
        .toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
      expect(factsFromPage(text, fact).drinks).toEqual([pint]);
    },
  );

  it.each(["draught, extra cold", "St. Austell cask"])(
    "keeps the printed pint name after an offer qualified by %s",
    (qualifier) => {
      const text = `Peroni pint £5.20 1/3 off ${qualifier};Guinness pint £6.20`;
      expect(readVenueDrinkPrices(text).kept).toMatchObject([pintRow]);
      expect(factsFromPage(text, fact).drinks).toEqual([pint]);
    },
  );

  it("keeps a digit-led drink name after a compact offer separator", () => {
    const text = "Peroni pint £5.20 1/3 off draught,1664 Blanc lager pint £6.20";
    expect(readVenueDrinkPrices(text).kept).toMatchObject([{ ...pintRow, drinkLabel: "1664 Blanc lager pint" }]);
    expect(factsFromPage(text, fact).drinks).toEqual([{ ...pint, drink: "1664 Blanc lager" }]);
  });

  it.each([
    "Peroni pint £5.20 1/3 off draught St. Austell Tribute pint £6.20",
    "Guinness pint £6.20, 2/3 discount;£5.20",
  ])("does not recover a price without its own named item: %s", (text) => {
    expect(readVenueDrinkPrices(text).kept).toEqual([]);
    expect(factsFromPage(text, fact).drinks).toEqual([]);
  });

  it("keeps the existing offer guard when ownership is unclear", () => {
    const text = "Guinness pint £6.20 1/3 discount on Peroni pint £5.20";
    expect(readVenueDrinkPrices(text).kept).toEqual([]);
    expect(factsFromPage(text, fact).drinks).toEqual([]);
  });

  it.each(["1 2/3 pint", "1 1 / 3 pint", "1⅔ pint", "1 2/3-pint", "1 2/3 of a pint"])(
    "rejects the mixed Tavily measure %s",
    (measure) => {
      expect(factsFromPage(`Peroni ${measure} £5.20`, fact).drinks).toEqual([]);
    },
  );

  it("preserves a named wine and its adjacent glass measure", () => {
    const text = "House wine 125ml £5.50,175ml £6.50";
    expect(factsFromPage(text, fact).drinks).toEqual([
      { drink: "House wine", size: "unstated", sizeDetail: "125ml", priceGbp: 5.5, standing: "listed", ...fact },
      { drink: "House wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5, standing: "listed", ...fact },
    ]);
  });

  it("preserves the no-row rule for a bare numeric fraction", () => {
    expect(factsFromPage("Peroni 2/3 £5.20", fact).drinks).toEqual([]);
  });

  it("does not give an unnamed fraction the preceding drink name", () => {
    expect(factsFromPage("Guinness pint £6.20, 2/3 pint £5.20", fact).drinks).toEqual([pint]);
  });

  it.each(["|", ".", ";", ",", ":", "•"])(
    "does not recover a nameless pint from across %s",
    (separator) => {
      expect(factsFromPage(`Guinness pint £6.20${separator}pint £6.00`, fact).drinks).toEqual([pint]);
    },
  );
});

describe("whole printed items with wrapped serving evidence", () => {
  it.each(["2/3 pint", "(1/3 pint)<br>(2/3 pint)"])("withholds a pint after %s inside the same block", (fraction) => {
    const menu = `<p>${fraction}<br>Guinness pint £6.20</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);

    const separate = `<p>${fraction}</p><p>Guinness pint £6.20</p>`;
    expect(readVenueDrinkPrices(separate, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(separate).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(separate, fact).drinks).toEqual([pint]);
  });

  it.each([
    "Guinness pint glass 568ml", "Guinness commemorative glass 568ml", "Guinness tankard 568ml",
    "Guinness pint tankard 568ml", "Guinness tankard pint", "Steak and Guinness 568ml", "Happy hour Guinness pint",
  ])("refuses a full pint beside the price of %s", (item) => {
    const menu = `<p>Guinness pint £6.20<br>(1/3 pint)<br>${item} £5.00</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it.each([
    ["<p>Guinness £6.20 /pint; Madri pint £6.40<br>(1/3 pint)</p>", "Guinness", "Guinness", 6.2],
    ["<p>(1/3 pint)<br>Guinness pint £6.20; Madri pint £6.40</p>", "Madri pint", "Madri", 6.4],
  ] as const)("preserves the sibling pint in %s", (menu, drinkLabel, drink, priceGbp) => {
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([{ drinkLabel, category: "beer", priceGbp }]);
    expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel, priceGbp }]);
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink, priceGbp }]);
  });

  it.each([
    "<p>Guinness pint £6.20<br>(1/3 pint)<br>Lager £6.40</p>",
    "<p>Madri £6.40 4.6% ABV<br>(1/3 pint)<br>Guinness pint £6.20</p>",
  ])("preserves the independently stated pint when another line names a drink in %s", (menu) => {
    expect(readVenueDrinkPrices(menu, "html").kept).toContainEqual(expect.objectContaining(pintRow));
    expect(readChainPintPrices(menu).kept).toContainEqual(expect.objectContaining({ drinkLabel: "Guinness pint", priceGbp: 6.2 }));
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it("keeps the independently stated pint but refuses a separate merchandise price", () => {
    const menu = "<p>Guinness pint £6.20<br>(1/3 pint)<br>Madri £6.40, Guinness T-shirt £8.00</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it("keeps a pint column that shares its row with a named half pint", () => {
    const menu = "<p>Paulaner Lager Helles 4.9% 1/2 Pint £4.05 Sierra Nevada IPA 4.2% 1/2 Pint £4.20 Pint £6.50</p>";
    expect(readVenueDrinkPrices(menu, "html").kept.map((row) => row.priceGbp)).toEqual([6.5]);
    expect(readChainPintPrices(menu).kept.map((row) => row.priceGbp)).toEqual([6.5]);
  });

  it("allows two distinct wrapped qualifiers to withhold equal prices on the same line", () => {
    const menu = "<p>(1/3 pint)<br>Guinness pint £6.20; Madri pint £6.20<br>(2/3 pint)</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it("carries a drink name to a measure inside its block", () => {
    const menu = "<p>Guinness<br>pint £6.20</p><p>House Merlot<br>175ml £6.50</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([
      pintRow,
      { drinkLabel: "House Merlot", servingSize: "175ml", category: "wine", priceGbp: 6.5 },
    ]);
    expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(menu, fact).drinks).toEqual([
      pint,
      { ...pint, drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
    ]);
  });

  it("does not lend a drink name to an unnamed measure in a separate block", () => {
    const menu = "<p>Guinness</p><p>pint £6.20</p><p>House Merlot</p><p>175ml £6.50</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it.each([
    "<p>Beer and cider<br>pint £6.20</p>",
    "<section><h2>Wine</h2><p>White wine:<br>125ml £7.00 250ml £14.00</p></section>",
  ])("does not use a drinks heading as a wrapped name in %s", (menu) => {
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it("keeps known and section-scoped wines with their wrapped pairs", () => {
    const menu = "<p>Chardonnay, France<br>125ml £5.50 250ml £11.00</p>"
      + "<section><h2>white</h2><p>Gavi de Gavi, Italy<br>125ml £7.00 250ml £14.00</p></section>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([
      { drinkLabel: "Chardonnay, France", servingSize: "125ml", category: "wine", priceGbp: 5.5 },
      { drinkLabel: "Chardonnay, France", servingSize: "250ml", category: "wine", priceGbp: 11 },
      { drinkLabel: "Gavi de Gavi, Italy", servingSize: "125ml", category: "wine", priceGbp: 7 },
      { drinkLabel: "Gavi de Gavi, Italy", servingSize: "250ml", category: "wine", priceGbp: 14 },
    ]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    const prices = findUkPriceCandidates(pageText(menu, true, "html"));
    expect([...readKeylessUkPriceDecisions(menu, "html").keys()]).toEqual(prices.map(({ at }) => at));
  });
});

describe("canonical reader evidence after a printed wrap", () => {
  it("uses a described fraction inside its own block", () => {
    const qualifier = "2/3 pint (draught)";
    const menu = `<p>Guinness pint £6.20<br>${qualifier}</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);

    const separate = `<p>Guinness pint £6.20</p><p>${qualifier}</p>`;
    expect(readVenueDrinkPrices(separate, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(separate).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(separate, fact).drinks).toEqual([pint]);
  });

  it("preserves an admitted beer name and a price before its pint measure", () => {
    const menu = "<p>Camden Hells<br>pint £6.30</p><p>Guinness<br>£6.20 pint</p>";
    const expected = [
      { drinkLabel: "Camden Hells pint", category: "beer", priceGbp: 6.3 },
      { drinkLabel: "Guinness", category: "beer", priceGbp: 6.2 },
    ];
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject(expected);
    expect(readChainPintPrices(menu).kept).toMatchObject(expected.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp })));
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Camden Hells", priceGbp: 6.3 }, pint]);
    const prices = findUkPriceCandidates(pageText(menu, true, "html"));
    expect([...readKeylessUkPriceDecisions(menu, "html").keys()]).toEqual(prices.map(({ at }) => at));
  });

  it("retains a stated wine-glass serving without treating glass as a pint", () => {
    const menu = "<p>House red wine glass 175ml £6.50</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([
      { drinkLabel: "House red wine glass", servingSize: "175ml", category: "wine", priceGbp: 6.5 },
    ]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([
      { ...pint, drink: "House red wine", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
    ]);
  });

  it.each(["Draught Beer:", "On Tap", "Cask Ale:"])("does not use %s as the name of a priced pint", (heading) => {
    const menu = `<p>${heading}<br>pint £6.20</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });
});

it.each(["Guinness tankard 568ml", "Guinness T-shirt", "Tea mug 568ml"])("keeps the price of %s out of the drinks readers", (item) => {
  const menu = `<p>${item} £5.00</p>`;
  expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
  expect(readChainPintPrices(menu).kept).toEqual([]);
  expect(factsFromPage(menu, fact).drinks).toEqual([]);
});

describe("price-local evidence inside a printed item", () => {
  it.each(["; ", " | ", ", ", ": ", " - "])("keeps the wrapped name with its price before %s", (separator) => {
    const menu = `<p>Guinness<br>£6.20 pint${separator}Madri pint £6.40</p>`;
    const expected = [
      { drinkLabel: "Guinness", category: "beer", priceGbp: 6.2 },
      { drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 },
    ];
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject(expected);
    expect(readChainPintPrices(menu).kept).toMatchObject(expected.map(({ drinkLabel, priceGbp }) => ({ drinkLabel, priceGbp })));
    expect(factsFromPage(menu, fact).drinks).toEqual([pint, { ...pint, drink: "Madri", priceGbp: 6.4 }]);
    const prices = findUkPriceCandidates(pageText(menu, true, "html"));
    expect([...readKeylessUkPriceDecisions(menu, "html").keys()]).toEqual(prices.map(({ at }) => at));
  });

  it.each([": ", " - "])("keeps explicit competing pint evidence before %s", (separator) => {
    const menu = `<p>Guinness pint £6.20<br>(1/3 pint)<br>Hawkstone £6.40 pint${separator}Madri pint £6.80</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toContainEqual(expect.objectContaining(pintRow));
    expect(readChainPintPrices(menu).kept).toContainEqual(expect.objectContaining({ drinkLabel: "Guinness pint", priceGbp: 6.2 }));
    expect(factsFromPage(menu, fact).drinks).toContainEqual(pint);
  });

  it("keeps a wine name, measure and price on three lines in the same item", () => {
    const menu = "<p>House Merlot<br>175ml<br>£6.50</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([
      { drinkLabel: "House Merlot", servingSize: "175ml", category: "wine", priceGbp: 6.5 },
    ]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([
      { ...pint, drink: "House Merlot", size: "unstated", sizeDetail: "175ml", priceGbp: 6.5 },
    ]);
  });

  it("does not recover a wine name for a measure and price in a separate item", () => {
    const menu = "<p>House Merlot</p><p>175ml<br>£6.50</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it.each(["", "; Madri pint £6.40"])("rejects the product named after its price before %s", (sibling) => {
    const menu = `<p>Guinness pint £6.20<br>(1/3 pint)<br>Guinness 568ml £5.00 commemorative tankard${sibling}</p>`;
    const venue = sibling ? [{ drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 }] : [];
    const chain = sibling ? [{ drinkLabel: "Madri pint", priceGbp: 6.4 }] : [];
    const tavily = sibling ? [{ ...pint, drink: "Madri", priceGbp: 6.4 }] : [];
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject(venue);
    expect(readChainPintPrices(menu).kept).toMatchObject(chain);
    expect(factsFromPage(menu, fact).drinks).toEqual(tavily);
  });

  it.each(["commemorative tankard", "commemorative glass"])(
    "keeps the %s description with the first price between commas",
    (description) => {
      const menu = `<p>Guinness 568ml £5.00, ${description}, Madri pint £6.40</p>`;
      expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([
        { drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 },
      ]);
      expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Madri pint", priceGbp: 6.4 }]);
      expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
    },
  );

  it.each(["Guinness 568ml £5.00 commemorative glass", "Guinness £5.20 pint glass"])(
    "refuses glassware when its description follows the price in %s",
    (item) => {
      const menu = `<p>${item}</p>`;
      expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
      expect(readChainPintPrices(menu).kept).toEqual([]);
      expect(factsFromPage(menu, fact).drinks).toEqual([]);
    },
  );

  it.each(["; ", " "])("does not assign a separate product's evidence to a pint before %s", (separator) => {
    const menu = `<p>Guinness pint £6.20${separator}Guinness tankard 568ml £5.00</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it.each(["\n\n", "\r\n \r\n"])("keeps a blank paragraph between a price and adjacent evidence", (gap) => {
    const separateName = `Guinness${gap}pint £6.20`;
    const separateFraction = `Guinness pint £6.20${gap}(1/3 pint)`;
    expect(readVenueDrinkPrices(separateName).kept).toEqual([]);
    expect(factsFromPage(separateName, fact).drinks).toEqual([]);
    expect(readVenueDrinkPrices(separateFraction).kept).toMatchObject([pintRow]);
    expect(factsFromPage(separateFraction, fact).drinks).toEqual([pint]);
    const withLaterPrice = `${separateFraction}${gap}Madri pint £6.40`;
    const prices = findUkPriceCandidates(pageText(withLaterPrice, true));
    expect([...readKeylessUkPriceDecisions(withLaterPrice).keys()]).toEqual(prices.map(({ at }) => at));
  });

  it("keeps a single text line break inside the printed item", () => {
    const wrappedName = "Guinness\npint £6.20";
    const wrappedFraction = "Guinness pint £6.20\n(1/3 pint)";
    expect(readVenueDrinkPrices(wrappedName).kept).toMatchObject([pintRow]);
    expect(factsFromPage(wrappedName, fact).drinks).toEqual([pint]);
    expect(readVenueDrinkPrices(wrappedFraction).kept).toEqual([]);
    expect(factsFromPage(wrappedFraction, fact).drinks).toEqual([]);
  });
});

describe("one admission for each original price", () => {
  it("rejects the adjacent goods price before considering the following unmeasured drink", () => {
    const menu = "<p>Guinness pint £6.20<br>(1/3 pint)<br>Guinness 568ml £5.00, commemorative tankard, Camden Hells £6.40</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([
      { drinkLabel: "Camden Hells", category: "beer", priceGbp: 6.4 },
    ]);
    expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Camden Hells", priceGbp: 6.4 }]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
    const raw = findUkPriceCandidates(pageText(menu, true, "html"));
    const decisions = readKeylessUkPriceDecisions(menu, "html");
    expect([...decisions.keys()]).toEqual(raw.map(({ at }) => at));
    expect(raw.map(({ at }) => decisions.get(at)?.drop)).toEqual([
      "fractional-measure-not-a-pint", "no-drink-word-nearby", undefined,
    ]);
  });

  it("keeps a pint with a glass-service description after its price", () => {
    const menu = "<p>Guinness pint £6.20 served in a glass</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it.each(["Guinness glass 568ml", "Guinness branded glass 568ml"])(
    "does not treat the capacity of %s as an independently priced pint",
    (item) => {
      const menu = "<p>Guinness pint £6.20<br>(1/3 pint)<br>" + item + " £5.00</p>";
      expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
      expect(readChainPintPrices(menu).kept).toEqual([]);
      expect(factsFromPage(menu, fact).drinks).toEqual([]);
    },
  );

  it.each(["2/3 pint draught", "2/3 pint (draught)", "(2/3 pint, draught)"])(
    "withholds the same-item pint when the menu states %s",
    (qualifier) => {
      const menu = "<p>Guinness pint £6.20 served in a glass<br>" + qualifier + "</p>";
      expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
      expect(readChainPintPrices(menu).kept).toEqual([]);
      expect(factsFromPage(menu, fact).drinks).toEqual([]);
      const separate = "<p>Guinness pint £6.20</p><p>" + qualifier + "</p>";
      expect(factsFromPage(separate, fact).drinks).toEqual([pint]);
    },
  );

  it.each(["2/3 pint Kernel stout", "2/3 pint (Kernel stout)", "(2/3 pint, Kernel stout)"])(
    "keeps an unpriced named serving separate from a pint before %s",
    (named) => {
      const menu = "<p>Guinness pint £6.20<br>" + named + "</p>";
      expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([pintRow]);
      expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
      expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
    },
  );

  it.each([
    "Affogato espresso 25ml £4.20", "Vodka Cranberry Juice 25ml £6.50",
    "Steak and Guinness pint £5.50", "Happy hour Guinness pint £5.50",
  ])("does not use an excluded drink to protect a contradicted pint beside %s", (item) => {
    const menu = "<p>Guinness pint £6.20<br>(1/3 pint)<br>" + item + "</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });
});

describe("item evidence and reader policy", () => {
  it.each(["Happy hour", "HAPPY HOUR:", "Today's offers", "Lunch offers", "Happy<br>hour", "Only for members"])(
    "keeps the standalone %s condition for both prices",
    (heading) => {
      const menu = "<p>" + heading + "<br>Guinness pint £6.20; Madri pint £6.40</p>";
      expect(readVenueDrinkPrices(menu, "html").drops)
        .toEqual(["offer-not-a-menu-price", "offer-not-a-menu-price"]);
      expect(readChainPintPrices(menu).kept).toEqual([]);
      expect(factsFromPage(menu, fact).drinks).toEqual([]);
    },
  );

  it("keeps a standalone offer cue between priced lines out of the previous item's notes", () => {
    const menu = "<p>Peroni pint £6.00<br>Happy hour<br>Guinness pint £6.20; Madri pint £6.40</p>";
    expect(readVenueDrinkPrices(menu, "html").drops).toEqual(Array.from({ length: 3 }, () => "offer-not-a-menu-price"));
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Peroni", priceGbp: 6 }]);
  });

  it("retains the original span of a group condition split across an inline break", () => {
    const menu = "<p>Happy<br>hour<br>Guinness pint £6.20; Madri pint £6.40</p>";
    const page = printedPageText(menu, "html");
    const claims = [...printedPriceLayout(page).prices.values()];
    expect(claims.map(({ scopedOffer }) => scopedOffer && page.text.slice(scopedOffer.start, scopedOffer.end)))
      .toEqual(["Happy\nhour", "Happy\nhour"]);
    expect(claims.map(({ label }) => label)).toEqual(["Guinness pint", "Madri pint"]);
  });

  it.each(["When you order a meal", "Available only with a meal", "Available only<br>with a meal", "2/3<br>discount"])(
    "keeps the leading offer clause %s with the first item",
    (condition) => {
      const menu = "<p>" + condition + "<br>Guinness pint £6.20; Madri pint £6.40</p>";
      const reading = readVenueDrinkPrices(menu, "html");
      expect(reading.drops).toEqual(["offer-not-a-menu-price"]);
      expect(reading.kept).toMatchObject([{ drinkLabel: "Madri pint", category: "beer", priceGbp: 6.4 }]);
      expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Madri pint", priceGbp: 6.4 }]);
      expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
    },
  );

  it("keeps the UK contextual offer check after it resolves a sibling's fractional discount", () => {
    const menu = "<p>Peroni pint happy hour £5.20 2/3 off; Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(menu, "html").drops)
      .toEqual(["offer-not-a-menu-price", "offer-not-a-menu-price"]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it("does not hide an ordinary offer cue before a different item's proven fraction", () => {
    const menu = "<p>Guinness pint £6.20, happy hour, Peroni pint 2/3 discount: £5.20</p>";
    expect(readVenueDrinkPrices(menu, "html").drops)
      .toEqual(["offer-not-a-menu-price", "offer-not-a-menu-price"]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it("keeps the UK offer window when regular prices follow a happy-hour heading", () => {
    const prices = "<p>IPA pint £4.50</p><p>Ale pint £4.60</p><p>Beer pint £4.70</p><p>Cask pint £4.80</p>";
    const menu = "<h2>Happy hour</h2>" + prices;
    const reading = readVenueDrinkPrices(menu, "html");
    expect(reading.kept).toEqual([]);
    expect(reading.drops).toEqual(Array.from({ length: 4 }, () => "offer-not-a-menu-price"));
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(readVenueDrinkPrices("<h2>Drinks</h2>" + prices, "html").kept.map(({ drinkLabel, category, priceGbp }) =>
      ({ drinkLabel, category, priceGbp }))).toEqual([
      { drinkLabel: "IPA pint", category: "beer", priceGbp: 4.5 },
      { drinkLabel: "Ale pint", category: "beer", priceGbp: 4.6 },
      { drinkLabel: "Beer pint", category: "beer", priceGbp: 4.7 },
      { drinkLabel: "Cask pint", category: "beer", priceGbp: 4.8 },
    ]);
  });

  it("retains the original item heading for a bare UK price without expanding Tavily", () => {
    const markdown = "#### Coke / Diet Coke 330ml glass bottle\n\n£3.50";
    const html = "<h4>Coke / Diet Coke 330ml glass bottle</h4><p>£3.50</p>";
    const expected = [{ drinkLabel: "Coke / Diet Coke 330ml glass bottle", category: "soft-drink", priceGbp: 3.5 }];
    expect(readVenueDrinkPrices(markdown).kept).toMatchObject(expected);
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject(expected);
    expect(factsFromPage(markdown, fact).drinks).toEqual([]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
    const raw = findUkPriceCandidates(pageText(markdown, true));
    expect([...readKeylessUkPriceDecisions(markdown).keys()]).toEqual(raw.map(({ at }) => at));
    expect(readVenueDrinkPrices("Coke / Diet Coke 330ml glass bottle\n\n£3.50").kept).toEqual([]);
    const separate = "<section><h4>Guinness pint</h4></section><section><p>£6.20</p></section>";
    expect(readVenueDrinkPrices(separate, "html").kept).toEqual([]);
    expect(readChainPintPrices(separate).kept).toEqual([]);
  });

  it("preserves the stated wine name when the first glass fails its price band", () => {
    const menu = "<section><h2>Wine</h2><p>Glass House Shiraz 125ml £1.00 \u2013 250ml £14.00</p></section>";
    const reading = readVenueDrinkPrices(menu, "html");
    expect(reading.drops).toEqual(["outside-category-band"]);
    expect(reading.kept).toMatchObject([
      { drinkLabel: "Glass House Shiraz", category: "wine", servingSize: "250ml", priceGbp: 14 },
    ]);
  });

  it("keeps both heading and container evidence at the same normalised offset", () => {
    const html = "<section><h4>Guinness pint</h4></section><section><h4>£6.20</h4></section>";
    const page = printedPageText(html, "html");
    const priceAt = page.text.indexOf("£");
    expect(page.text).toBe(pageText(html, true, "html"));
    expect(page.headings.get(priceAt)).toBe(4);
    expect(page.structuralBreaks.has(priceAt - 1)).toBe(true);
    expect(page.containerBreaks.has(priceAt - 1)).toBe(true);
    expect(readVenueDrinkPrices(html, "html").kept).toEqual([]);
    expect(readChainPintPrices(html).kept).toEqual([]);

    const sameSection = "<section><h4>Coke / Diet Coke 330ml glass bottle</h4><h4>£3.50</h4></section>";
    expect(readVenueDrinkPrices(sameSection, "html").kept).toMatchObject([
      { drinkLabel: "Coke / Diet Coke 330ml glass bottle", category: "soft-drink", priceGbp: 3.5 },
    ]);
  });

  it("does not inherit a menu heading from a preceding container", () => {
    const html = "<section><h2>Wine</h2></section><section><h4>Hawkstone</h4><p>£6.20</p></section>";
    expect(readVenueDrinkPrices(html, "html").kept).toEqual([]);
    expect(readChainPintPrices(html).kept).toEqual([]);
  });

  it("keeps the current menu heading inside a nested wrapper", () => {
    const html = "<section><h2>Beer</h2><div><h4>Hawkstone</h4><p>£6.20</p></div></section>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([
      { drinkLabel: "Beer Hawkstone", category: "beer", priceGbp: 6.2 },
    ]);
  });

  it("preserves both price offsets when a scope ends between figures on one line", () => {
    const html = "<pre>Drinks\nGuinness pint £6.20</pre>Madri pint £6.40";
    const page = printedPageText(html, "text", { preserveSourceLines: true });
    const raw = findUkPriceCandidates(page.text);
    expect(page.text).toBe("Drinks\nGuinness pint £6.20 Madri pint £6.40");
    expect([...printedPriceLayout(page).prices.keys()]).toEqual(raw.map(({ at }) => at));
    expect(printedPriceLayout(page).lines.filter(({ priceOffsets }) => priceOffsets.length)
      .map(({ menuSection }) => menuSection)).toEqual(["drinks", null]);
  });

  it("refuses a raw amount that crosses a container and retains its decision offset", () => {
    const html = "<pre>Drinks\nGuinness pint £</pre>6.20";
    const page = printedPageText(html, "text", { preserveSourceLines: true });
    const raw = findUkPriceCandidates(page.text);
    expect(raw).toHaveLength(1);
    expect([...printedPriceLayout(page).prices.keys()]).toEqual(raw.map(({ at }) => at));
    expect([...readKeylessUkPriceDecisions(html).values()]).toEqual([{ drop: "not-verbatim-on-page" }]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
  });

  it.each([
    "<ul><li><h4>Hawkstone</h4><p>£6.20</p></li></ul>",
    "<table><tr><td><h4>Hawkstone</h4><p>£6.20</p></td></tr></table>",
  ])("keeps the enclosing Beer heading inside an item in %s", (item) => {
    const html = "<section><h2>Beer</h2>" + item + "</section>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([
      { drinkLabel: "Beer Hawkstone", category: "beer", priceGbp: 6.2 },
    ]);
    expect(printedPageText(html, "html").text).toBe(pageText(html, true, "html"));
  });

  it("closes the previous list item's heading when the closing tag is implicit", () => {
    const html = "<ul><li><h2>Wine</h2><li><h4>Hawkstone</h4><p>£6.20</p></ul>";
    expect(readVenueDrinkPrices(html, "html").kept).toEqual([]);
    expect(readChainPintPrices(html).kept).toEqual([]);
  });

  it.each([
    ["with a burger", "food-word-nearby"],
    ["served<br>with a burger", "food-word-nearby"],
    ["served<br>with olives", "food-word-nearby"],
    ["happy<br>hour", "offer-not-a-menu-price"],
    ["when you order a meal", "offer-not-a-menu-price"],
    ["2/3 off", "offer-not-a-menu-price"],
    ["2/3<br>off", "offer-not-a-menu-price"],
  ])("passes the same-item note %s to the shared refusal policy", (note, reason) => {
    const html = "<p>Guinness pint £6.20<br>" + note + "</p>";
    expect(readVenueDrinkPrices(html, "html").drops).toEqual([reason]);
    expect(readChainPintPrices(html).kept).toEqual([]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
  });

  it.each([
    "<p>Guinness pint £6.20</p><p>with a burger</p>",
    "<p>Guinness pint £6.20; Madri pint £6.20<br>with a burger</p>",
    "<p>Guinness pint £6.20<br>Burger<br>£12.00</p>",
  ])("does not lend food wording from another item in %s", (html) => {
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it.each(["2/3 off", "2/3<br>off", "happy hour", "happy<br>hour"])(
    "keeps the previous price when %s describes only its sibling",
    (note) => {
      const html = "<p>Guinness pint £6.20; Madri pint £6.40<br>" + note + "</p>";
      const reading = readVenueDrinkPrices(html, "html");
      expect(reading.kept).toMatchObject([pintRow]);
      expect(reading.drops).toEqual(["offer-not-a-menu-price"]);
      expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
      expect(factsFromPage(html, fact).drinks).toEqual([pint]);
    },
  );

  it("checks a complete offer note even when a sibling has a fractional discount", () => {
    const html = "<p>Peroni pint £5.20 2/3 off; Guinness pint £6.20 happy<br>hour</p>";
    expect(readVenueDrinkPrices(html, "html").drops)
      .toEqual(["offer-not-a-menu-price", "offer-not-a-menu-price"]);
    expect(readChainPintPrices(html).kept).toEqual([]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
  });

  it("does not let a product described after a break protect a disputed pint", () => {
    const html = "<p>Guinness pint £6.20<br>(1/3 pint)<br>Guinness 568ml £5.00<br>commemorative tankard</p>";
    expect(readVenueDrinkPrices(html, "html").drops)
      .toEqual(["fractional-measure-not-a-pint", "no-drink-word-nearby"]);
    expect(readChainPintPrices(html).kept).toEqual([]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
  });

  it.each([
    "Served with a burger<br>Guinness pint £6.20",
    "Served<br>with olives<br>Guinness pint £6.20",
    "Served with<br>wine<br>Guinness pint £6.20",
    "Served with a burger<br>Guinness<br>pint £6.20",
    "Served<br>with olives<br>Guinness<br>pint £6.20",
  ])("checks the note before the named price without making it part of the name in %s", (body) => {
    const html = "<p>" + body + "</p>";
    expect(readVenueDrinkPrices(html, "html").drops).toEqual(["food-word-nearby"]);
    expect(readChainPintPrices(html).kept).toEqual([]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
    const [price] = [...printedPriceLayout(printedPageText(html, "html")).prices.values()];
    expect(price).toMatchObject({ label: "Guinness pint" });
  });

  it("does not borrow a leading food note across a paragraph boundary", () => {
    const html = "<p>Served with a burger</p><p>Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([pintRow]);
    expect(readChainPintPrices(html).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
    expect(factsFromPage(html, fact).drinks).toEqual([pint]);
  });

  it("keeps a wrapped drink name that begins with When", () => {
    const html = "<p>When It Rains IPA<br>pint £6.20</p>";
    expect(readVenueDrinkPrices(html, "html").kept).toMatchObject([
      { drinkLabel: "When It Rains IPA pint", category: "beer", priceGbp: 6.2 },
    ]);
    expect(factsFromPage(html, fact).drinks).toEqual([{ ...pint, drink: "When It Rains IPA" }]);
  });

  it("checks a discount split across lines before the named price", () => {
    const html = "<p>2/3<br>off<br>Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(html, "html").drops).toEqual(["offer-not-a-menu-price"]);
    expect(readChainPintPrices(html).kept).toEqual([]);
    expect(factsFromPage(html, fact).drinks).toEqual([]);
  });

  it("reports a missing drink category before the food refusal in UK fallback", () => {
    const filler = "<p>" + "Our kitchen serves hearty plates every day of the week. ".repeat(6) + "</p>";
    const html = "<p>Madri pint £6.20</p>" + filler + "<p>Steak and chips supper £6.20</p>";
    const text = pageText(html, true);
    const raw = findUkPriceCandidates(text);
    expect(raw).toHaveLength(2);
    expect(raw.map((candidate) => decideKeylessUkPriceCandidate(text, candidate).drop))
      .toEqual([undefined, "no-category-word-nearby"]);
    expect([...readKeylessUkPriceDecisions(html).values()].map(({ drop }) => drop))
      .toEqual([undefined, "no-category-word-nearby"]);
    expect(readVenueDrinkPrices("<p>Steak and Guinness pint £6.20</p>").drops)
      .toEqual(["food-word-nearby"]);
    expect(readVenueDrinkPrices("<p>Chicken broth 175ml £6.20</p>").drops)
      .toEqual(["no-category-word-nearby"]);
  });

  it("keeps a shared refusal tied to its own category evidence", () => {
    const layout = printedPriceLayout(printedPageText("<p>Affogato espresso 25ml £4.20</p>", "html"));
    expect([...layout.prices.values()].map(({ admission }) => admission)).toMatchObject([
      { kind: "refused", drop: "no-category-word-nearby", category: { category: "coffee", source: "item" } },
    ]);
  });

  it.each(["2/3 pint Hawkstone", "2/3 pint (Hawkstone)", "(2/3 pint, Hawkstone)", "(2/3, Hawkstone)"])(
    "does not infer a serving description from an unrecognised residual name in %s",
    (fragment) => {
      const menu = "<p>Guinness pint £6.20<br>" + fragment + "</p>";
      expect(readVenueDrinkPrices(menu, "html").kept).toMatchObject([pintRow]);
      expect(readChainPintPrices(menu).kept).toMatchObject([{ drinkLabel: "Guinness pint", priceGbp: 6.2 }]);
      expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
    },
  );

  it("keeps extra cold with the stated fractional serving", () => {
    const menu = "<p>Guinness pint £6.20<br>2/3 pint (extra cold)</p>";
    expect(readVenueDrinkPrices(menu, "html").drops).toEqual(["fractional-measure-not-a-pint"]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it.each([
    "2/3 pint (4.2% ABV)", "(2/3 pint,4,2 % ABV)", "2/3 pint draught (5%)", "(2/3, 4.2% ABV)",
    "2/3 pint 4.2% ABV.", "2/3 pint 4.2%.", "(2/3) 4.2% ABV",
  ])(
    "keeps the stated strength with the fractional serving in %s",
    (fragment) => {
      const html = "<p>Guinness pint £6.20<br>" + fragment + "</p>";
      expect(readVenueDrinkPrices(html, "html").drops).toEqual(["fractional-measure-not-a-pint"]);
      expect(readChainPintPrices(html).kept).toEqual([]);
      expect(factsFromPage(html, fact).drinks).toEqual([]);
    },
  );
});

describe("offer boundary corrections", () => {
  it("ends a preformatted offer at a regular drinks section", () => {
    const menu = "<pre>Happy hour\nGuinness pint £6.20\nRegular drinks\nMadri pint £6.40</pre>";
    const page = printedPageText(menu, "text", { preserveSourceLines: true });
    const claims = [...printedPriceLayout(page).prices.values()];
    expect(claims.map(({ raw, scopedOffer }) => [raw.at, scopedOffer?.start, scopedOffer?.end]))
      .toEqual([[25, 0, 10], [57, undefined, undefined]]);
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
  });

  it("keeps an offer through a category refinement", () => {
    const menu = "<pre>Happy hour\nGuinness pint £6.20\nCask ale\nMadri pint £6.40</pre>";
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it("masks the connected fractional clause for a separate named pint", () => {
    const menu = "<p>Peroni pint £5.20, only today 2/3 discount; Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(menu, "html").kept.map(({ drinkLabel, category, priceGbp }) =>
      [drinkLabel, category, priceGbp])).toEqual([["Guinness pint", "beer", 6.2]]);
    expect(readChainPintPrices(menu).kept.map(({ drinkLabel, priceGbp }) => [drinkLabel, priceGbp]))
      .toEqual([["Guinness pint", 6.2]]);
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it("leaves separately delimited offer wording visible to the UK reader", () => {
    const menu = "<p>Peroni pint £5.20, happy hour, only today 2/3 discount; Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
  });

  it("keeps a priced offer heading scoped through children and ends it at the next heading", () => {
    const menu = "<section><h2>Happy hour: 2 for £10</h2><p>Guinness pint £6.20</p>" +
      "<h2>Drinks</h2><p>Madri pint £6.40</p></section>";
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
  });

  it("ends a priced offer at an inline soft container close", () => {
    const menu = "<aside><h2>Happy hour: 2 for £10</h2><span>Guinness pint £6.20</span></aside>" +
      "<span>Madri pint £6.40</span>";
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
  });

  it.each(["Guinness pint £6.20 happy hour", "Happy hour Guinness pint £6.20"])(
    "keeps a priced named heading condition with its own item: %s",
    (heading) => {
      const menu = `<section><h2>${heading}</h2><p>Madri pint £6.40</p></section>`;
      expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
    },
  );

  it("keeps a named multi-buy heading as a condition for its children", () => {
    const menu = "<section><h2>Guinness pint 2 for £10</h2><p>Madri pint £6.40</p></section>";
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });
});

it("keeps a priced offer heading active to the end of its container", () => {
  const menu = "<section><h2>Happy hour: 2 for £10</h2><p>Guinness pint £6.20</p></section>";
  const page = printedPageText(menu, "text", { preserveSourceLines: true });
  const claims = [...printedPriceLayout(page).prices.values()];
  expect(claims.map(({ raw, admission, scopedOffer }) => [
    raw.at, admission.kind, scopedOffer && page.text.slice(scopedOffer.start, scopedOffer.end),
  ])).toEqual([
    [page.text.indexOf("£10"), "refused", "Happy hour"],
    [page.text.indexOf("£6.20"), "refused", "Happy hour"],
  ]);
  expect(factsFromPage(menu, fact).drinks).toEqual([]);
});

describe("owned offer scope corrections", () => {
  it.each([
    "<pre>Regular drinks\nGuinness pint £6.20</pre>",
    "<pre>Regular beers\nGuinness pint £6.20</pre>",
    "<h3>Regular drinks</h3><p>Guinness pint £6.20</p>",
    "<h3>Regular beers</h3><p>Guinness pint £6.20</p>",
    "<pre>Happy hour\nMadri pint £6.40\nRegular drinks\nGuinness pint £6.20</pre>",
  ])("retains an enclosing membership condition through %s", (content) => {
    const menu = `<section><h2>Only for members</h2>${content}</section>`;
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it("ends the preceding condition at a same-level regular heading", () => {
    const menu = "<section><h2>Only for members</h2><p>Guinness pint £6.20</p>" +
      "<h2>Regular beers</h2><p>Madri pint £6.40</p></section>";
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
  });

  it("ends a local happy-hour condition at regular beers", () => {
    const menu = "<pre>Happy hour\nGuinness pint £6.20\nRegular beers\nMadri pint £6.40</pre>";
    expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
  });

  it("does not end a local happy-hour condition at cask ale", () => {
    const menu = "<pre>Happy hour\nGuinness pint £6.20\nCask ale\nMadri pint £6.40</pre>";
    expect(factsFromPage(menu, fact).drinks).toEqual([]);
  });

  it("keeps the connected colon clause with its discounted item", () => {
    const menu = "<p>Peroni pint £5.20, today only: 2/3 discount; Guinness pint £6.20</p>";
    expect(readVenueDrinkPrices(menu, "html").kept.map(({ drinkLabel, category, priceGbp }) =>
      [drinkLabel, category, priceGbp])).toEqual([["Guinness pint", "beer", 6.2]]);
    expect(readChainPintPrices(menu).kept.map(({ drinkLabel, priceGbp }) => [drinkLabel, priceGbp]))
      .toEqual([["Guinness pint", 6.2]]);
    expect(factsFromPage(menu, fact).drinks).toEqual([pint]);
  });

  it.each([",", ":"])("leaves a separate condition before a %s-delimited discount clause", (delimiter) => {
    const menu = `<p>Peroni pint £5.20, happy hour${delimiter} today only: 2/3 discount; Guinness pint £6.20</p>`;
    expect(readVenueDrinkPrices(menu, "html").kept).toEqual([]);
    expect(readChainPintPrices(menu).kept).toEqual([]);
  });

  it.each(["all draught beer pints", "draught beer pints", "cask ale pint"])(
    "keeps the category-wide priced heading condition for %s",
    (category) => {
      const menu = `<section><h2>Happy hour: ${category} £5.20</h2><p>Guinness pint £6.20</p></section>`;
      const page = printedPageText(menu, "text", { preserveSourceLines: true });
      const claims = [...printedPriceLayout(page).prices.values()];
      expect(claims.map(({ scopedOffer }) => scopedOffer && page.text.slice(scopedOffer.start, scopedOffer.end)))
        .toEqual(["Happy hour", "Happy hour"]);
      expect(factsFromPage(menu, fact).drinks).toEqual([]);
    },
  );

  it.each(["Guinness pint", "Camden Hells pint", "Mystery pint"])(
    "keeps the existing named-serving boundary for %s",
    (item) => {
      const menu = `<section><h2>Happy hour: ${item} £6.20</h2><p>Madri pint £6.40</p></section>`;
      expect(factsFromPage(menu, fact).drinks).toEqual([{ ...pint, drink: "Madri", priceGbp: 6.4 }]);
    },
  );
});
