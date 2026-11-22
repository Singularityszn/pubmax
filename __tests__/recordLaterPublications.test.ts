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
