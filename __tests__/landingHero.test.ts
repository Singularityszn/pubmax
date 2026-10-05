import { describe, expect, it } from "vitest";

import {
  answerEvidenceFor,
  answerKicker,
  HERO_RAIL_SIZE,
  LANDING_FALLBACK_RECEIPT_HREF,
  LANDING_FALLBACK_RECEIPT_LABEL,
  LANDING_PRIMARY_HREF,
  LANDING_PRIMARY_LABEL,
  pintDropDoorHref,
  railHeading,
  stillPriceLabel,
} from "@/lib/landingHero";
import { mapLogIntentPrice } from "@/lib/mapLogIntent";
import { buildLandingAnchorRail, buildLandingArchiveIndex } from "@/lib/landingPubCard";
import type { Venue } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

function venue(id: string, name: string, cheapestPrice: number | null, extra: Partial<Venue> = {}): Venue {
  return {
    id,
    name,
    slug: id,
    primaryBorough: "City of London",
    lat: 51.5,
    lng: -0.1,
    cheapestPrice,
    cheapestPint: "PRAVHA",
    prices: [{ app_price_id: `${id}-1`, pint_name: "PRAVHA", price_gbp: cheapestPrice, pub_url: "https://www.pint-prices.com/pub/x" }],
    ...extra,
  } as Venue;
}

function history(rows: Array<{ venueId: string; priceGbp: number; observedOn: string }>) {
  return {
    version: 1,
    generatedAt: "2026-09-01",
    observations: rows.map((row) => ({
      ...row,
      venueName: row.venueId,
      quote: "quoted",
      source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x", licence: "quoted" },
    })),
  };
}

describe("landing hero policy", () => {
  it("names the one filled action after the price on the card", () => {
    expect(stillPriceLabel(6.5)).toBe("Still £6.50?");
    expect(stillPriceLabel(2.99)).toBe("Still £2.99?");
  });

  it("opens the Pint Drop door of that pub: the map, that pub selected, the composer open", () => {
    expect(pintDropDoorHref("venue-eltcmh")).toBe("/map?sel=venue-eltcmh&log=1");
  });

  it("carries the figure the tap printed, so the composer opens holding it", () => {
    // #1462 — "Still £6.50?" landing on an empty field asks the reader to type
    // back the number it just showed them.
    expect(pintDropDoorHref("venue-eltcmh", 6.5)).toBe(
      "/map?sel=venue-eltcmh&log=1&price=6.50",
    );
    expect(pintDropDoorHref("venue-eltcmh", 4.2)).toBe(
      "/map?sel=venue-eltcmh&log=1&price=4.20",
    );
    expect(mapLogIntentPrice(defined(pintDropDoorHref("venue-eltcmh", 6.5).split("?")[1]))).toBe("6.50");
  });

  it("says the same figure in the label and in the door", () => {
    for (const priceGbp of [2.99, 4.2, 6.5, 12]) {
      const seeded = mapLogIntentPrice(defined(pintDropDoorHref("venue-x", priceGbp).split("?")[1]));
      expect(stillPriceLabel(priceGbp)).toBe(`Still £${seeded}?`);
    }
  });

  it("leaves the door plain when there is no figure to carry", () => {
    expect(pintDropDoorHref("venue-eltcmh", Number.NaN)).toBe("/map?sel=venue-eltcmh&log=1");
    expect(pintDropDoorHref("venue-eltcmh", 0)).toBe("/map?sel=venue-eltcmh&log=1");
    expect(pintDropDoorHref("venue-eltcmh", -6.5)).toBe("/map?sel=venue-eltcmh&log=1");
  });

  it("gives a stranger an answer before it asks them for anything", () => {
    // The one filled action on the front door. /near answers from a London
    // patch when the reader refuses location, so this tap never ends at a wall.
    expect(LANDING_PRIMARY_HREF).toBe("/near?locate=1");
    expect(LANDING_PRIMARY_LABEL).toBe("Cheapest pints near me");
  });

  it("keeps the plain receipt door for a document with no card behind it", () => {
    // Quiet, and it asks for no location: only the primary carries locate=1.
    expect(LANDING_FALLBACK_RECEIPT_HREF).toBe("/near");
    expect(LANDING_FALLBACK_RECEIPT_LABEL).toBe("Log what you paid");
  });

  it("words the kicker and the rail heading from where the answer came", () => {
    expect(answerKicker("anchor", "City of London")).toBe("City of London");
    expect(answerKicker("walkable", "Soho")).toBe("Cheapest listed near you");
    expect(answerKicker("widened", "Soho")).toBe("Nearest listed pint");
    expect(railHeading("anchor", "City of London")).toBe("Cheapest listed in City of London");
    expect(railHeading("walkable", "Soho")).toBe("Next cheapest");
  });

  it("reads publisher and standing off the price rows through the one decider", () => {
    const named = answerEvidenceFor(
      {
        priceGbp: 6.5,
        prices: [
          { app_price_id: "p1", pint_name: "X", price_gbp: 6.5 },
          {
            app_price_id: "p2",
            pint_name: "PRAVHA",
            price_gbp: 6.5,
            pub_url: "https://www.pint-prices.com/pub/x",
            scraped_at_values: "2026-07-03T23:10:47+00:00",
          },
        ],
      },
      NOW,
    );
    // Read at 23:10 UTC on 3 July, which London calls 4 July: the day a caption prints.
    expect(named).toEqual({
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
      standing: "listed",
      observedOn: "2026-07-04",
    });
    const unnamed = answerEvidenceFor(
      { priceGbp: 6.5, prices: [{ app_price_id: "p1", pint_name: "X", price_gbp: 6.5 }] },
      NOW,
    );
    expect(unnamed).toEqual({ publisher: null, standing: "none", observedOn: null });
    // A listing past its window falls to none, however good its page.
    const stale = answerEvidenceFor(
      {
        priceGbp: 6.5,
        prices: [
          {
            app_price_id: "p1",
            pint_name: "X",
            price_gbp: 6.5,
            pub_url: "https://www.pint-prices.com/pub/x",
            scraped_at_values: "2024-07-03T12:00:00Z",
          },
        ],
      },
      NOW,
    );
    expect(stale.standing).toBe("none");
  });

  it("dates a listing by the day its own row was read, never by a later re-collection", () => {
    // Two pubs in one bundle: one the latest re-read restated, one it did not.
    // Each keeps the day its own row was read at the source.
    const restated = answerEvidenceFor(
      {
        priceGbp: 6,
        prices: [
          {
            app_price_id: "p1",
            pint_name: "MAHOU",
            price_gbp: 6,
            pub_url: "https://www.pint-prices.com/pub/bradleys",
            scraped_at_values: "2026-07-03T23:10:47+00:00|2026-10-02T11:48:33+00:00",
          },
        ],
      },
      NOW,
    );
    const unread = answerEvidenceFor(
      {
        priceGbp: 6,
        prices: [
          {
            app_price_id: "p2",
            pint_name: "ASPALL DRAUGHT CYDER",
            price_gbp: 6,
            pub_url: "https://tattoo-bar.co.uk/menu",
            scraped_at_values: "2026-08-21T15:44:29.901Z",
          },
        ],
      },
      NOW,
    );
    expect(restated.observedOn).toBe("2026-10-02");
    expect(unread.observedOn).toBe("2026-08-21");
    // A published row that records no read cannot claim a listing.
    const undated = answerEvidenceFor(
      {
        priceGbp: 6,
        prices: [
          { app_price_id: "p3", pint_name: "X", price_gbp: 6, pub_url: "https://www.pint-prices.com/pub/x" },
        ],
      },
      NOW,
    );
    expect(undated).toEqual({
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
      standing: "none",
      observedOn: null,
    });
  });

  it("takes a row re-read this morning as evidence this morning", () => {
    const readAt = Date.parse("2026-10-02T07:09:42Z");
    const evidence = answerEvidenceFor(
      {
        priceGbp: 6,
        prices: [
          {
            app_price_id: "p1",
            pint_name: "MAHOU",
            price_gbp: 6,
            pub_url: "https://www.pint-prices.com/pub/bradleys",
            scraped_at_values: "2026-10-02T07:09:42Z",
          },
        ],
      },
      readAt + 60 * 60 * 1000,
    );
    expect(evidence).toMatchObject({ standing: "listed", observedOn: "2026-10-02" });
  });

  it("dates the row that carries the printed figure", () => {
    const evidence = answerEvidenceFor(
      {
        priceGbp: 5.9,
        prices: [
          {
            app_price_id: "p1",
            pint_name: "AMSTEL",
            price_gbp: 6.35,
            pub_url: "https://www.pint-prices.com/pub/cheese",
            scraped_at_values: "2026-07-03T23:10:47+00:00",
          },
          {
            app_price_id: "p2",
            pint_name: "LONDON PRIDE",
            price_gbp: 5.9,
            pub_url: "https://www.pint-prices.com/pub/cheese",
            scraped_at_values: "2026-10-02T11:48:33+00:00",
          },
        ],
      },
      NOW,
    );
    expect(evidence.observedOn).toBe("2026-10-02");
  });
});

describe("landing archive index", () => {
  it("holds one dated row per priced pub with its printed labels, oldest row first", () => {
    const index = buildLandingArchiveIndex(
      [venue("venue-a", "A", 6.5), venue("venue-b", "B", null), venue("venue-c", "C", 5)],
      history([
        { venueId: "venue-a", priceGbp: 3.75, observedOn: "2015-08-05" },
        { venueId: "venue-a", priceGbp: 3.6, observedOn: "2013-07-14" },
        { venueId: "venue-b", priceGbp: 3, observedOn: "2014-01-01" },
      ]),
      NOW,
    );
    expect(Object.keys(index)).toEqual(["venue-a"]);
    expect(index["venue-a"]).toEqual({
      priceGbp: 3.6,
      observedOn: "2013-07-14",
      observedMonth: "July 2013",
      observedDay: "14 July 2013",
      years: 13,
      source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
    });
  });
});

describe("landing anchor rail", () => {
  it("takes the three cheapest listed pubs in the anchor's borough, the anchor left out", () => {
    const venues = [
      venue("venue-anchor", "The Blackfriar", 6.5),
      venue("venue-1", "The Crosse Keys", 2.99),
      venue("venue-2", "The Liberty Bounds", 2.99),
      venue("venue-3", "The Sir John Hawkshaw", 3.49),
      venue("venue-4", "The Albion", 5.4),
      venue("venue-else", "Elsewhere", 1, { primaryBorough: "Camden" }),
      venue("venue-unpriced", "No price", null),
      venue("venue-bar", "A bar", 2, { kind: "bar" } as Partial<Venue>),
    ];
    const rail = buildLandingAnchorRail(venues, { id: "venue-anchor", area: "City of London" }, { "venue-3": {} as never });
    expect(rail).toHaveLength(HERO_RAIL_SIZE);
    expect(rail.map((row) => [row.name, row.priceGbp, row.hasThen])).toEqual([
      ["The Crosse Keys", 2.99, false],
      ["The Liberty Bounds", 2.99, false],
      ["The Sir John Hawkshaw", 3.49, true],
    ]);
    expect(rail.every((row) => row.area === "City of London" && row.walkMinutes === undefined)).toBe(true);
  });

  it("answers an empty rail rather than padding it", () => {
    expect(buildLandingAnchorRail([venue("venue-anchor", "Only", 5)], { id: "venue-anchor", area: "City of London" }, {})).toEqual([]);
  });
});
