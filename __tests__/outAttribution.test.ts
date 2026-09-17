import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OutCard } from "@/components/out/OutCard";
import { SourceCredit } from "@/components/out/SourceCredit";
import { priceBucket, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { mergeCommunityPriceSignals } from "@/components/map/communityPriceSignals";
import type { CommunityPrice } from "@/lib/communityPrice";
import { trustedDrinkLensPrices } from "@/lib/mapExperienceLens";
import { rankBoroughCheapest } from "@/lib/nearMeAnswer";
import { createSkiddleProvider } from "@/lib/events/skiddle";
import { OUT_CARD_SOURCES, outCardSource, outSourceAttribution } from "@/lib/out/attribution";
import { skiddleLaneFenced } from "@/lib/whatson/eventNormalise.mjs";
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

describe("Skiddle credit, and the fence standing in for the asset we do not hold", () => {
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

  it("renders the Skiddle name and the event link whenever a Skiddle row is on screen", () => {
    const html = renderToStaticMarkup(SourceCredit({ source: eventRow().source }));
    expect(html).toContain("Skiddle");
    expect(html).toContain("https://www.skiddle.com/whats-on/e/1");
  });

  it("draws no mark at all, rather than an imitation of somebody else's wordmark", () => {
    const html = renderToStaticMarkup(SourceCredit({ source: eventRow().source }));
    expect(html).not.toMatch(/<svg|<img|<canvas/i);
    // The name is text a reader can select, not a drawn lookalike.
    expect(html).toMatch(/<span>Skiddle<\/span>/);
  });

  it("holds the Skiddle lane shut while the official asset is absent, key or no key", () => {
    // The obligation is real and undischarged, so the FENCE is what gates the
    // lane - not the missing API key.
    expect(skiddleLaneFenced()).toBe(true);

    const original = process.env.SKIDDLE_API_KEY;
    process.env.SKIDDLE_API_KEY = "a-real-key";
    try {
      expect(createSkiddleProvider().isConfigured()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.SKIDDLE_API_KEY;
      else process.env.SKIDDLE_API_KEY = original;
    }
  });

  it("spells every publisher the same way on the card and in the attribution", () => {
    const commonSource = { label: "common", url: "https://www.common-social.com/post/abc" };
    // A row carries the label its own lane wrote down; a reader sees the
    // publisher's name, beside two others that are already capitalised.
    expect(renderToStaticMarkup(SourceCredit({ source: commonSource }))).toMatch(
      /<span>Common<\/span>/,
    );
    expect(outSourceAttribution([eventRow({ source: commonSource })])).toEqual([
      { label: "Common", logoRequired: false, url: "https://www.common-social.com/" },
    ]);
    // A venue's own listing keeps its own name, which is not ours to restyle.
    const venueSource = { label: "The Ivy House", url: "https://theivyhousenunhead.com/" };
    expect(renderToStaticMarkup(SourceCredit({ source: venueSource }))).toContain("The Ivy House");
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
  // WHERE A CARD GOES IS THE ROW'S OWN ROUTE. The publisher's event page comes
  // first, because the credit and the link are one claim and the attribution is
  // owed either way; the pub keeps its own way in beside the card, which is the
  // rule lib/tonightOutListings.ts already states for the same rows on Tonight.
  it("opens the publisher's own event page, matched or not", () => {
    const unmatched = renderToStaticMarkup(
      createElement(OutCard, { row: eventRow({ venueId: "   " }) }),
    );
    expect(unmatched).toMatch(/<a[^>]*class="[^"]*outCard[^"]*"/);
    expect(unmatched).toContain('href="https://www.skiddle.com/whats-on/e/1"');
    expect(unmatched).toMatch(/class="[^"]*outSourceCredit[^"]*"/);
  });

  it("falls back to the pub when the publisher published no event page", () => {
    const html = renderToStaticMarkup(
      createElement(OutCard, {
        row: eventRow({
          venueId: " venue-warehouse ",
          source: { label: "Skiddle", url: "https://www.skiddle.com/" },
        }),
      }),
    );

    expect(html).toContain('href="/map?sel=venue-warehouse"');
    expect(html).toMatch(/<a[^>]*class="[^"]*outCard[^"]*"/);
    // A front door is no event page, so the credit prints as text, not a link.
    expect(html).toMatch(/class="[^"]*outSourceCredit[^"]*outSourceCredit--unlinked[^"]*"/);
  });

  it("stays visibly static when neither a pub nor an event page exists", () => {
    const html = renderToStaticMarkup(
      createElement(OutCard, {
        row: eventRow({
          venueId: "   ",
          source: { label: "Skiddle", url: "https://www.skiddle.com/" },
        }),
      }),
    );

    expect(html).toMatch(/class="[^"]*outCard[^"]*outCard--static[^"]*"/);
    expect(html).not.toMatch(/<a[^>]*class="[^"]*outCard[^"]*"/);
  });

  it("keeps the source credit its own link, after the card and never inside it", () => {
    const html = renderToStaticMarkup(createElement(OutCard, { row: eventRow() }));
    const creditAnchorAt = html.search(/class="[^"]*outSourceCredit(?!--)/);
    const cardAt = html.search(/class="[^"]*outCard(?!Place)/);
    expect(creditAnchorAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(-1);
    expect(cardAt).toBeLessThan(creditAnchorAt);
    // An anchor inside an anchor is invalid HTML the parser un-nests, so the
    // card anchor must CLOSE before the credit anchor opens.
    expect(html.indexOf("</a>")).toBeLessThan(creditAnchorAt);
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

  it("only a community price reaches a merged signal, so the ticketed pub stays unpriced", () => {
    const row = ticketedEventRow();
    const signals = new Map<string, VenueSignal>([
      [TICKETED_VENUE_ID, { hasPintDrops: false, latestContributorPrice: null } as VenueSignal],
      ["venue-logged", { hasPintDrops: false, latestContributorPrice: null } as VenueSignal],
    ]);
    const now = Date.parse("2026-08-16T18:00:00.000Z");
    // A real, corroborated, in-window community pint on the OTHER pub. The
    // merge admits that one and has no way to hear about a ticket price.
    const community = new Map<string, CommunityPrice>([
      [
        "venue-logged",
        {
          venueId: "venue-logged",
          drinkCategory: "beer",
          priceGbp: 5.2,
          submittedAt: now - 60_000,
          source: "community",
          corroborations: 2,
        },
      ],
    ]);
    const merged = mergeCommunityPriceSignals(signals, community, now);
    expect(merged.get("venue-logged")?.latestContributorPrice).toBe(5.2);
    expect(merged.get(TICKETED_VENUE_ID)?.latestContributorPrice).toBeNull();
    expect(JSON.stringify([...merged.values()])).not.toContain(String(row.priceGbp));

    // Cheapest-first ranking qualifies on the venue's own cheapestPrice, which
    // the merge above left null for the ticketed pub.
    const cheapest = rankBoroughCheapest(
      [
        {
          id: TICKETED_VENUE_ID,
          name: row.placeName,
          borough: "Southwark",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: merged.get(TICKETED_VENUE_ID)?.latestContributorPrice ?? null,
        },
        {
          id: "venue-logged",
          name: "The Logged Arms",
          borough: "Southwark",
          lat: 51.5,
          lng: -0.1,
          cheapestPrice: merged.get("venue-logged")?.latestContributorPrice ?? null,
        },
      ],
      "Southwark",
    );
    expect(cheapest.map((card) => card.id)).toEqual(["venue-logged"]);
    expect(trustedDrinkLensPrices(new Map(), "beer").get(TICKETED_VENUE_ID)).toBeUndefined();
  });

  it("names the closed card-source set without ids or coords", () => {
    expect(OUT_CARD_SOURCES).toEqual(["ticketmaster", "skiddle", "common", "venue"]);
    expect(outCardSource("Skiddle")).toBe("skiddle");
    expect(outCardSource("Ticketmaster")).toBe("ticketmaster");
    expect(outCardSource("common")).toBe("common");
    expect(outCardSource("The Hope")).toBe("venue");
  });
});
