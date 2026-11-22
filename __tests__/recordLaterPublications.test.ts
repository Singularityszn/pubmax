// THE RECEIPT NAMES THE PAGE THAT SERVED ITS WORDS.
//
// scripts/harvest/uk-prices/record-later-publications.mjs re-reads each source
// page to keep a verbatim excerpt beside the rows it published. The host picks
// the last hop, so the excerpt can come from a page other than the source URL.
// These cases pin that the landing is asked about (source policy, then robots)
// and that the read answers the landing as `evidenceUrl`.

import { describe, expect, it } from "vitest";

import type { RobotsChecker } from "@/lib/harvest/robots";

import { readCapturedSectionPrices, readEvidence } from "../scripts/harvest/uk-prices/record-later-publications.mjs";

const ROWS = [{ priceGbp: 6.5 }];
const PAGE = "<html><body><p>Neck Oil IPA pint £6.50</p></body></html>";

/** A fetch that answers one page and reports where it landed. */
function landingFetch(landedUrl: string, body = PAGE): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    url: landedUrl,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => body,
    body: null,
  })) as unknown as typeof fetch;
}

function robotsAllowing(allowed: (url: string) => boolean): RobotsChecker {
  return async (url: string) =>
    allowed(url)
      ? { allowed: true, reason: "no-rules-published", robots: "absent", evidence: "test" }
      : { allowed: false, reason: "robots-disallowed", robots: "rules-file", evidence: "test" };
}

describe("the evidence re-read", () => {
  it("keeps the complete menu for replay, including headings and later prices", async () => {
    const menu = `Cocktails ${"Menu introduction. ".repeat(50)}Golden Fig £12 ${"Menu description. ".repeat(50)}Jungle Bird £13`;
    const read = await readEvidence(
      "https://thelamb.example/menu", [{ priceGbp: 12 }], robotsAllowing(() => true),
      landingFetch("https://thelamb.example/menu", `<html><body>${menu}</body></html>`),
    );
    expect(read.evidence).toBe(menu);
  });

  it("captures the text layer of a permitted PDF menu for replay", async () => {
    const stream = "BT /F1 12 Tf 40 760 Td (Cocktails) Tj 0 -20 Td (Manhattan \\24312.50) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((body, i) => {
      const offset = pdf.length;
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
      return offset;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const response = new Response(Buffer.from(pdf, "latin1"), { headers: { "content-type": "application/pdf" } });
    const read = await readEvidence(
      "https://thelamb.example/menu.pdf", [{ priceGbp: 12.5 }], robotsAllowing(() => true),
      (async () => response) as typeof fetch,
    );
    expect(readCapturedSectionPrices(read.evidence, ["Manhattan"])).toEqual([
      { drinkLabel: "Manhattan", category: "cocktail", priceGbp: 12.5 },
    ]);
  });

  it("names the landing page when a permitted redirect serves the excerpt", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing(() => true),
      landingFetch("https://thelamb.example/drinks/2026"),
    );
    expect(read.evidence).toContain("£6.50");
    expect(read.evidenceUrl).toBe("https://thelamb.example/drinks/2026");
  });

  it("keeps no excerpt when the landing page's robots rules refuse it", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing((url) => !url.includes("/drinks/")),
      landingFetch("https://thelamb.example/drinks/2026"),
    );
    expect(read.evidence).toMatch(/^not re-read: redirected to https:\/\/thelamb\.example\/drinks\/2026, robots/);
    expect(read.evidence).not.toContain("£6.50");
  });

  it("names the source itself when nothing redirected", async () => {
    const read = await readEvidence(
      "https://thelamb.example/menu",
      ROWS,
      robotsAllowing(() => true),
      landingFetch("https://thelamb.example/menu"),
    );
    expect(read.evidenceUrl).toBe("https://thelamb.example/menu");
  });
});

describe("saved menu section reader", () => {
  it("reads printed titles after ingredients and letter-spaced PDF headings", () => {
    const text = "CO C K TA I L S\nNegroni £12.50\nGin, Campari, vermouth\nJungle Bird £12.50\nRum, pineapple\nGolden Fig   .......... £11.50\nTequila, fig\nSPARKLING & CHAMPAGNE\nProsecco £39.50";
    expect(readCapturedSectionPrices(text, ["Negroni", "Jungle Bird", "Golden Fig", "Gin"])).toEqual([
      { drinkLabel: "Negroni", category: "cocktail", priceGbp: 12.5 },
      { drinkLabel: "Jungle Bird", category: "cocktail", priceGbp: 12.5 },
      { drinkLabel: "Golden Fig", category: "cocktail", priceGbp: 11.5 },
    ]);
  });

  it("reads a title before its price after the preceding drink's inline ingredients", () => {
    expect(readCapturedSectionPrices("Cocktails Picante Spritz £12 Tequila, Honey, Lime, Soda Yuzu Honeybee £13 Jameson Irish Whiskey, Ginger Ale", ["Picante Spritz", "Yuzu Honeybee", "Tequila"])).toEqual([
      { drinkLabel: "Picante Spritz", category: "cocktail", priceGbp: 12 },
      { drinkLabel: "Yuzu Honeybee", category: "cocktail", priceGbp: 13 },
    ]);
  });

  it("reads the Marquess drinks excerpt without classifying its snacks as drinks", () => {
    const text = "Savoursmith crisps £1.6 Dry Roasted Peanuts or Salted Crust Peanuts £2.25 Tea & Coffee Birchall Tea £3.5 English Breakfast, Peppermint, Earl Grey, Green Tea Flat White £3.75 Cafe Latte £4 Espresso £3 Hot Chocolate £4.25";
    expect(readCapturedSectionPrices(text)).toEqual([
      { drinkLabel: "Birchall Tea", category: "other", priceGbp: 3.5 },
      { drinkLabel: "Flat White", category: "coffee", priceGbp: 3.75 },
      { drinkLabel: "Cafe Latte", category: "coffee", priceGbp: 4 },
      { drinkLabel: "Espresso", category: "coffee", priceGbp: 3 },
      { drinkLabel: "Hot Chocolate", category: "other", priceGbp: 4.25 },
    ]);
  });

  it("keeps a priced drink under a drinks heading when no candidate name matches it", () => {
    const text = "Back to the top of the Menu Spritz Pomegranate gi Fizz Plymouth Gin, Elderflower, Pomegranate, Cranberry, Prosecco, Soda £12.00 Winter Sangria Martini Rosso, Burnt Faith Peach Liqueur, Fever-Tree Blood Orange Soda £11.50";
    expect(readCapturedSectionPrices(text, ["Winter Sangria"])).toEqual([
      { drinkLabel: "Pomegranate gi Fizz Plymouth Gin", category: "cocktail", priceGbp: 12 },
      { drinkLabel: "Winter Sangria", category: "cocktail", priceGbp: 11.5 },
    ]);
  });

  it("keeps an unnamed item only when it reads plainly as a cocktail", () => {
    const text = "Cocktails Salty Paloma Tequila, grapefruit, salt £12 Make it a porn star (add a prosecco shot), please £1.50 "
      + "Negroni 0.0 AF Lyre's, bitters £10.50 CHAPEL DOWN BRUT RESERVE - Kent, England £70 Baby Guinness   Kahlua, Baileys £6 "
      + "House Rosé Wine Grenache, Provence £8";
    expect(readCapturedSectionPrices(text)).toEqual([
      { drinkLabel: "Salty Paloma Tequila", category: "cocktail", priceGbp: 12 },
    ]);
  });

  it("keeps no unnamed item outside a cocktail section", () => {
    expect(readCapturedSectionPrices("Soft Drinks Germany Riesling, crisp £7 Alcohol-Free Three Spirit Social, bottle £35")).toEqual([]);
  });

  it("does not keep an unnamed item under a drinks heading when it is food", () => {
    expect(readCapturedSectionPrices("Cocktails Garlic bread, mozzarella, rocket £6.50 Negroni Gin, Campari £12", ["Negroni"])).toEqual([
      { drinkLabel: "Negroni", category: "cocktail", priceGbp: 12 },
    ]);
  });

  it("uses a drink heading for the Duke titles without using their ingredients as names", () => {
    const text = "Back to the top of the Menu Spritz Winter Sangria Martini Rosso, Burnt Faith Peach Liqueur, Fever-Tree Blood Orange Soda £11.50 Yuzu Honeybee Jameson Irish Whiskey, Beesou Honey Aperitif, Yuzu Sherbet, Fever-Tree Ginger Ale £13.00 Cocktails Espresso Martini Absolut Vodka, Kahlúa, Coffee £12.50";
    expect(readCapturedSectionPrices(text, ["Winter Sangria", "Yuzu Honeybee", "Espresso Martini", "Jameson"])).toEqual([
      { drinkLabel: "Winter Sangria", category: "cocktail", priceGbp: 11.5 },
      { drinkLabel: "Yuzu Honeybee", category: "cocktail", priceGbp: 13 },
      { drinkLabel: "Espresso Martini", category: "cocktail", priceGbp: 12.5 },
    ]);
    expect(readCapturedSectionPrices("Yuzu Honeybee Jameson Irish Whiskey, Soda £13", ["Yuzu Honeybee"])).toEqual([]);
  });

  it("takes figures from the saved page and preserves each explicit measure", () => {
    expect(readCapturedSectionPrices("Bottled Beers/Ciders\nHeineken £4.35\nStella £4.35\nWine\nOrchard Light 125ml £5.50 250ml £9 Bottle £25", ["Heineken", "Stella", "Orchard Light"])).toEqual([
      { drinkLabel: "Heineken", category: "beer", priceGbp: 4.35, servingSize: "bottle" },
      { drinkLabel: "Stella", category: "beer", priceGbp: 4.35, servingSize: "bottle" },
      { drinkLabel: "Orchard Light", category: "wine", priceGbp: 5.5, servingSize: "125ml" },
      { drinkLabel: "Orchard Light", category: "wine", priceGbp: 9, servingSize: "250ml" },
      { drinkLabel: "Orchard Light", category: "wine", priceGbp: 25, servingSize: "bottle" },
    ]);
  });

  it("ends category inheritance at a food heading", () => {
    expect(readCapturedSectionPrices("Cocktails\nGolden Fig £12\nFood\nBombay Aloo £6\nSoft Drinks\nGarden Fizz £4", ["Golden Fig", "Bombay Aloo", "Garden Fizz"])).toEqual([
      { drinkLabel: "Golden Fig", category: "cocktail", priceGbp: 12 },
      { drinkLabel: "Garden Fizz", category: "soft-drink", priceGbp: 4 },
    ]);
    expect(readCapturedSectionPrices("not re-read as text: the page is a PDF", ["Jungle Bird"])).toEqual([]);
    expect(readCapturedSectionPrices("Cocktails\nGolden Fig 2 for £9", ["Golden Fig"])).toEqual([]);
    expect(readCapturedSectionPrices("Beer\nHeineken £4.35", ["Heineken"])).toEqual([]);
  });
});
