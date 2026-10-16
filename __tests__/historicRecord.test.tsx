/** @vitest-environment jsdom */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  analyticsCollectionAllowed: () => false,
}));

import HistoricPubDetail from "@/app/historic/[slug]/HistoricPubDetail";
import type { HistoricPub } from "@/lib/historic";
import { historicRecord, recordTextContainedIn } from "@/lib/historicFilter";
import type { LegacyPintPrice } from "@/lib/drinks";
import { venueListedPint } from "@/lib/venueListedPint";

const HOOK =
  "The Prospect of Whitby is a Grade II* listed pub on Wapping Wall in the East End, reputed to be one of the oldest riverside taverns in London, dating from around 1520.";
const REF = "https://en.wikipedia.org/wiki/Prospect_of_Whitby";

const PROSPECT: HistoricPub = {
  venueId: "venue-16pnwmm",
  name: "Prospect of Whitby",
  slug: "prospect-of-whitby",
  borough: "Tower Hamlets",
  lat: 51.5071,
  lng: -0.0511255,
  hook: HOOK,
  facts: [
    { source: "seed", fact: "Riverside Wapping pub usually dated to 1520.", sourceRef: REF },
    { source: "wikipedia", fact: HOOK, sourceRef: REF },
    {
      source: "wikidata",
      fact: "historic public house on the banks of the Thames at Wapping, London",
      sourceRef: REF,
    },
  ],
  era: "1520",
  dateLabel: "Founded 1520",
  listed: "II*",
  sourced: true,
};

describe("the record says each thing once", () => {
  it("leaves out the intro and a fact the intro already says", () => {
    const record = historicRecord(PROSPECT);
    expect(record.facts.map((fact) => fact.source)).toEqual(["wikidata"]);
    // The intro's own source is still named, by the fact that IS the intro.
    expect(record.introSource?.source).toBe("wikipedia");
  });

  it("keeps the fuller of two facts where one contains the other, in record order", () => {
    const record = historicRecord({
      hook: "",
      facts: [
        { source: "wikidata", fact: "pub in Hammersmith, London" },
        { source: "seed", fact: "A riverside pub on Upper Mall in Hammersmith, London, by the Thames." },
        { source: "osm", fact: "Serves real ale since 1740." },
      ],
    });
    expect(record.facts.map((fact) => fact.source)).toEqual(["seed", "osm"]);
    expect(record.introSource).toBeNull();
  });

  it("measures containment on normalised words, not on punctuation or case", () => {
    expect(recordTextContainedIn("PUB on Fleet Street.", "A pub on Fleet Street, London")).toBe(true);
    expect(recordTextContainedIn("Serves real ale since 1740.", "pub in Hammersmith, London")).toBe(false);
  });

  it("renders one intro source line instead of the repeated lead", () => {
    const html = renderToStaticMarkup(createElement(HistoricPubDetail, { pub: PROSPECT }));
    expect(html).toContain("The lead above is cited from");
    expect(html).toContain(`href="${REF}"`);
    // The hook is the lede once, never again as a record entry.
    expect(html.split("oldest riverside taverns").length - 1).toBe(1);
    expect(html).not.toContain("usually dated to 1520");
  });
});

function row(over: Partial<LegacyPintPrice>): LegacyPintPrice {
  return {
    app_price_id: "p1",
    pub_name: "Prospect of Whitby",
    pint_name: "Prospect Ale",
    price_gbp: 5,
    pub_url: "https://www.pint-prices.com/pub/57%20Wapping%20Wall,%20E1W%203SH/Prospect%20of%20Whitby",
    scraped_at_values: "2026-10-02T11:48:33+00:00",
    ...over,
  } as LegacyPintPrice;
}

describe("a historic pub leads with the pint the app lists for it", () => {
  it("reads the cheapest figure, its drink, publisher and day off the venue's own rows", () => {
    const listed = venueListedPint({
      cheapestPrice: 5,
      cheapestPint: "Prospect Ale",
      prices: [row({}), row({ app_price_id: "p2", pint_name: "Guinness", price_gbp: 6.35 })],
    });
    expect(listed).toEqual({
      priceGbp: 5,
      pintName: "Prospect Ale",
      publisher: {
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/57%20Wapping%20Wall,%20E1W%203SH/Prospect%20of%20Whitby",
      },
      observedOn: "2026-10-02",
    });
  });

  it("holds no listed pint for a venue with no figure", () => {
    expect(venueListedPint({ cheapestPrice: null, cheapestPint: "", prices: [] })).toBeNull();
  });

  it("prints the price, the drink, the publisher and the collected day", () => {
    const html = renderToStaticMarkup(
      createElement(HistoricPubDetail, {
        pub: PROSPECT,
        listedPint: venueListedPint({ cheapestPrice: 5, cheapestPint: "Prospect Ale", prices: [row({})] }),
      }),
    );
    expect(html).toContain("£5.00");
    expect(html).toContain("Prospect Ale");
    expect(html).toMatch(/Listed by <a [^>]*>Pint Prices<\/a>, collected 2 October 2026\./);
  });

  it("says so in words, with the way to log one, when no price is held", () => {
    const html = renderToStaticMarkup(
      createElement(HistoricPubDetail, { pub: PROSPECT, listedPint: null }),
    );
    expect(html).toContain("No price logged here yet.");
    expect(html).toContain("Log what you paid");
    expect(html).toContain("/map?sel=venue-16pnwmm&amp;log=1");
  });
});
