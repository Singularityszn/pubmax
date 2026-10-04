import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DrinkBrandLandingContent from "@/components/drinks/DrinkBrandLandingContent";
import TonightCheapPints from "@/app/tonight/TonightCheapPints";
import { buildDrinkBrandLanding } from "@/lib/drinkBrandLanding";
import { oldestPintRead } from "@/lib/drinks";
import { nearPriceTrustObservedAt, resolveNearPriceTrust } from "@/lib/nearPriceTrust";
import { faqItems, pintFactStats } from "@/lib/pintFacts";
import type { Venue, VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

// A price is dated by the read of its own row. The 2 October re-collection did
// not re-read every row, and a row last read in July says July, never the
// dataset's collection day.

const JULY = "2026-07-03T11:15:56.000Z";
const OCTOBER = "2026-10-02T11:48:33.000Z";

function priceRow(id: string, price: number, read: string | undefined): VenuePrice {
  return {
    app_price_id: id,
    pub_name: id,
    pint_name: "GUINNESS",
    price_gbp: price,
    price_text: `£${price.toFixed(2)}`,
    pub_url: "https://www.pint-prices.com/pub/x",
    ...(read === undefined ? {} : { scraped_at_values: read }),
  } as VenuePrice;
}

function venue(id: string, price: number, read: string | undefined): Venue {
  return {
    id,
    name: `The ${id}`,
    primaryBorough: "Camden",
    cheapestPrice: price,
    prices: [priceRow(id, price, read)],
  } as Venue;
}

describe("a price is dated by its own row's read", () => {
  it("takes the oldest read of the prices it prints, and no day when one records none", () => {
    expect(oldestPintRead([OCTOBER, JULY])).toBe(JULY);
    expect(oldestPintRead([OCTOBER, null])).toBeNull();
    expect(oldestPintRead([])).toBeNull();
  });

  it("dates a brand page with a row last read in July as July, not 2 October", () => {
    const venues = Array.from({ length: 24 }, (_, index) =>
      venue(`pub-${String(index).padStart(2, "0")}`, 5 + index / 10, index === 3 ? JULY : OCTOBER),
    );
    const landing = buildDrinkBrandLanding("guinness", venues);
    expect(landing?.collectedAt).toBe(JULY);
    const html = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, { landing: landing!, mapSelectableVenueIds: null }),
    );
    expect(html).toContain("Collected 3 July 2026.");
    expect(html).not.toContain("2 October 2026");
  });

  it("dates the quiet-night cheap pints by their own reads", () => {
    const html = renderToStaticMarkup(
      createElement(TonightCheapPints, {
        rows: [
          { venueId: "a", name: "A", borough: "Camden", priceGbp: 4, chain: null, observedAt: OCTOBER },
          { venueId: "b", name: "B", borough: "Camden", priceGbp: 4.2, chain: null, observedAt: JULY },
        ],
      }),
    );
    expect(html).toContain("Snapshot from 3 July 2026");
    expect(html).not.toContain("2 October 2026");
  });

  it("dates a borough's cheapest pint by that pint's own read", () => {
    const stats = pintFactStats([venue("cheap", 3.5, JULY), venue("dear", 7, OCTOBER)], "Camden", "camden");
    const [cheapest] = faqItems(stats, { monthYear: "October 2026", year: "2026" });
    expect(defined(cheapest).answer).toBe(
      "The cheapest tracked pint in Camden is £3.50 at The cheap, as collected on 3 July 2026.",
    );
    const [unread] = faqItems(
      pintFactStats([venue("cheap", 3.5, undefined)], "Camden", "camden"),
      { monthYear: "October 2026", year: "2026" },
    );
    expect(defined(unread).answer).toBe("The cheapest tracked pint in Camden is £3.50 at The cheap.");
  });

  it("carries a near-you price's own read into the accepted venue's provenance", () => {
    const item = resolveNearPriceTrust(venue("near", 4, JULY));
    expect(item?.observedAt).toBe(JULY);
    expect(nearPriceTrustObservedAt(item ? [item] : [], "near")).toBe(JULY);
    expect(nearPriceTrustObservedAt([], "near")).toBeNull();
  });
});
