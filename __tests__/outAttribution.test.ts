import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OutCard } from "@/components/out/OutCard";
import { SourceCredit } from "@/components/out/SourceCredit";
import { priceBucket, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { mergeCommunityPriceSignals } from "@/components/map/communityPriceSignals";
import { trustedDrinkLensPrices } from "@/lib/mapExperienceLens";
import { rankBoroughCheapest } from "@/lib/nearMeAnswer";
import { OUT_CARD_SOURCES, outCardSource, outSourceAttribution } from "@/lib/out/attribution";
import type { Venue } from "@/lib/venues";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { summariseWhatsOnByVenue } from "@/lib/whatsOnBadges";

function eventRow(overrides: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id: "events-sk-1",
    placeName: "A Basement",
    kind: "event",
    startsAt: "2026-08-16T21:00:00.000Z",
    title: "Warehouse Night",
    priceGbp: 12,
    source: { label: "Skiddle", url: "https://www.skiddle.com/whats-on/e/1" },
    observedAt: "2026-08-16T09:00:00.000Z",
    confidence: "listed",
    sourceId: "1",
    ...overrides,
  };
}

describe("Skiddle name and logo credit", () => {
  it("requires a logo whenever a Skiddle row is in the answer", () => {
    const attribution = outSourceAttribution([eventRow()]);
    expect(attribution).toEqual([
      {
        label: "Skiddle",
        logoRequired: true,
        url: "https://www.skiddle.com/",
      },
    ]);
  });

  it("renders the Skiddle name and logo whenever a Skiddle row is on screen", () => {
    const html = renderToStaticMarkup(
      SourceCredit({ source: eventRow().source }),
    );
    expect(html).toMatch(/Skiddle/);
    expect(html).toMatch(/<img|svg/i);
    expect(html).toMatch(/skiddle/i);
    expect(html).toMatch(/https:\/\/www\.skiddle\.com\/whats-on\/e\/1/);
  });

  it("does not require the Skiddle logo for a Ticketmaster-only list", () => {
    const attribution = outSourceAttribution([
      eventRow({
        source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
      }),
    ]);
    expect(attribution.some((item) => item.label === "Skiddle")).toBe(false);
    expect(attribution[0]).toMatchObject({ label: "Ticketmaster", logoRequired: false });
  });
});

describe("the out card", () => {
  it("keeps the source credit link OUT of the card link", () => {
    const html = renderToStaticMarkup(createElement(OutCard, { row: eventRow() }));
    const cardAnchorAt = html.indexOf('class="outCard"');
    const creditAnchorAt = html.indexOf('class="outSourceCredit"');
    expect(cardAnchorAt).toBeGreaterThan(-1);
    expect(creditAnchorAt).toBeGreaterThan(-1);
    // The card link has already closed before the credit link opens, so the
    // parser has no nested anchor to un-nest and the Skiddle event link stays
    // inside the item it belongs to.
    const cardClosesAt = html.indexOf("</a>", cardAnchorAt);
    expect(cardClosesAt).toBeLessThan(creditAnchorAt);
    expect(html).toContain("https://www.skiddle.com/whats-on/e/1");
  });

  it("prints a stated date with no clock time, and never invents one", () => {
    const html = renderToStaticMarkup(
      createElement(OutCard, {
        row: eventRow({
          startsAt: undefined,
          startsDate: "2026-08-16",
          timeEvidence: "Date listed, start time not published",
          priceGbp: undefined,
          source: { label: "common", url: "https://www.common-social.com/post/abc" },
        }),
      }),
    );
    expect(html).toContain("Sun 16 Aug");
    expect(html).not.toMatch(/\d{2}:\d{2}/);
  });

  it("prints the exact clock time when the listing states one", () => {
    const html = renderToStaticMarkup(createElement(OutCard, { row: eventRow() }));
    expect(html).toContain("22:00");
    expect(html).toContain("from £12");
  });
});

describe("event ticket price stays off price lanes", () => {
  // The event row and the pub it names, wired through the REAL adapters the map
  // uses. A ticket price may print on the /out card and nowhere else, so each
  // assertion below drives a production entry point rather than reading source.
  const TICKETED_VENUE_ID = "venue-ticketed";

  function ticketedEventRow(): WhatsOnRow {
    return eventRow({
      id: "events-tm-ticketed",
      venueId: TICKETED_VENUE_ID,
      placeName: "The Ticketed Arms",
      priceGbp: 12,
      source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/9" },
    });
  }

  function ticketedVenue(): Venue {
    return {
      id: TICKETED_VENUE_ID,
      name: "The Ticketed Arms",
      address: "Somewhere",
      latitude: 51.5,
      longitude: -0.1,
      kind: "pub",
      primaryBorough: "Southwark",
      visibleBoroughs: [],
      prices: [],
      cheapestPrice: null,
      cheapestPint: "",
      averagePrice: null,
      hasStory: false,
      latestContributorPrice: null,
      latestContributorAt: null,
      amenities: {
        food: false,
        cocktails: false,
        beerGarden: false,
        liveSports: false,
        liveMusic: false,
        pubQuiz: false,
        darts: false,
        pool: false,
        happyHour: false,
        karaoke: false,
        nonAlcoholic: false,
      },
      website: "",
    } as unknown as Venue;
  }

  it("prints the ticket price on the out card and on nothing the map paints", () => {
    const row = ticketedEventRow();
    expect(row.priceGbp).toBe(12);

    // summariseWhatsOnByVenue is the ONE adapter from a WhatsOnRow to the map.
    // Whatever it carries, it may not carry a figure.
    const whatsOnByVenue = summariseWhatsOnByVenue([row]);
    expect(whatsOnByVenue.get(TICKETED_VENUE_ID)?.heroKind).toBe("event");
    expect(JSON.stringify([...whatsOnByVenue.values()])).not.toContain("12");

    // The pin built from that same summary: no band, no printed figure.
    const features = pubsToGeoJSON(
      [ticketedVenue()],
      new Map(),
      null,
      null,
      whatsOnByVenue,
    ).features;
    const props = features[0]?.properties as Record<string, unknown>;
    expect(props.whatsOn).toBe("event");
    expect(props.bucket).toBe(priceBucket(null));
    expect(props.priceLabel).toBeUndefined();
  });

  it("leaves the venue out of a cheapest bucket and out of every merged signal", () => {
    const row = ticketedEventRow();
    const signals = new Map<string, VenueSignal>();

    // The community-price merge and the drink lens both read the community
    // price store. Nothing there knows about listings, so the venue stays
    // unpriced on both lanes.
    expect(mergeCommunityPriceSignals(signals, new Map())).toBe(signals);
    expect(mergeCommunityPriceSignals(signals, new Map()).get(TICKETED_VENUE_ID)).toBeUndefined();
    expect(trustedDrinkLensPrices(new Map(), "beer").get(TICKETED_VENUE_ID)).toBeUndefined();

    // Cheapest-first ranking qualifies on cheapestPrice alone, so a pub whose
    // only figure is a ticket price never enters a cheapest bucket.
    const cheapest = rankBoroughCheapest(
      [
        {
          id: TICKETED_VENUE_ID,
          name: row.placeName,
          borough: "Southwark",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: null,
        },
        {
          id: "venue-priced",
          name: "The Priced Arms",
          borough: "Southwark",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: 5.2,
        },
      ],
      "Southwark",
    );
    expect(cheapest.map((card) => card.id)).toEqual(["venue-priced"]);
  });

  it("names the closed card-source set without ids or coords", () => {
    expect(OUT_CARD_SOURCES).toEqual(["ticketmaster", "skiddle", "common", "venue"]);
    expect(outCardSource("Skiddle")).toBe("skiddle");
    expect(outCardSource("Ticketmaster")).toBe("ticketmaster");
    expect(outCardSource("common")).toBe("common");
    expect(outCardSource("The Hope")).toBe("venue");
  });
});
