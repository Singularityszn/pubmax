import { describe, expect, it } from "vitest";

import { buildLandingPubCard, LANDING_PUB_PREFERENCE } from "@/lib/landingPubCard";
import type { Venue } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

// The landing's one real pub is built from data alone: a listed price from
// the priced index, a publisher only when the row names one, and a dated,
// sourced archive row. No venue that lacks either half can be chosen, and no
// figure is invented when nothing qualifies.

const NOW = Date.UTC(2026, 8, 3, 12);

function venue(
  id: string,
  name: string,
  price: number | null,
  pubUrl = "https://www.pint-prices.com/pub/x",
  readAt = "2026-07-03T11:15:56+00:00",
): Venue {
  return {
    id,
    name,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "City of London",
    visibleBoroughs: ["City of London"],
    prices: [
      {
        app_price_id: id,
        pub_name: name,
        pint_name: "PRAVHA",
        price_gbp: price,
        price_text: price === null ? "" : `£${price}`,
        address: "1 Test Street",
        latitude: 51.5,
        longitude: -0.1,
        boroughs_visible: "City of London",
        boroughs_raw_embedded_non_anomaly: "",
        boroughs_raw_embedded_site_anomaly: "",
        primary_borough: "City of London",
        rank_visible_borough: "",
        estimated_average_price_text: "",
        pub_url: pubUrl,
        scraped_at_values: readAt,
        constructed_pub_url: "",
        borough_urls: "",
        phone_number: "",
        email: "",
        website: "",
        booking_link: "",
        image_url: "",
        description: "",
        comment: "",
        food: "",
        cocktails: "",
        beer_garden: "",
        live_sports: "",
        live_music: "",
        pub_quiz: "",
        darts: "",
        pool: "",
        happy_hour: "",
        karaoke: "",
        cool: "",
        source_datasets: "test",
        source_row_count: 1,
        has_visible_borough_row: true,
        has_raw_embedded_map_row: false,
        has_individual_pub_page_row: false,
      } as Venue["prices"][number],
    ],
    cheapestPrice: price,
    cheapestPint: "PRAVHA",
    averagePrice: price,
    hasStory: false,
    latestContributorPrice: null,
    latestContributorAt: null,
    amenities: {
      food: false, cocktails: false, beerGarden: false, liveSports: false, liveMusic: false,
      pubQuiz: false, darts: false, pool: false, happyHour: false, karaoke: false, nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
  } as Venue;
}

function history(rows: Array<{ venueId: string; priceGbp: number; observedOn: string }>) {
  return {
    version: 1,
    generatedAt: "2026-07-27",
    observations: rows.map((row) => ({
      venueId: row.venueId,
      venueName: "Test",
      priceGbp: row.priceGbp,
      observedOn: row.observedOn,
      source: {
        label: "beerintheevening.com",
        url: "https://www.beerintheevening.com/pubs/x",
        licence: "quoted with attribution",
      },
    })),
  };
}

describe("landing pub card", () => {
  it("builds the card from the listed price, the publisher and the oldest archive row", () => {
    const card = buildLandingPubCard(
      [venue("venue-eltcmh", "The Blackfriar", 6.5)],
      history([
        { venueId: "venue-eltcmh", priceGbp: 3.75, observedOn: "2015-08-05" },
        { venueId: "venue-eltcmh", priceGbp: 3.6, observedOn: "2013-07-14" },
      ]),
      { now: NOW },
    );
    expect(card).toEqual({
      id: "venue-eltcmh",
      name: "The Blackfriar",
      area: "City of London",
      priceGbp: 6.5,
      pintName: "a pint of Pravha",
      // One pub is under the drink-brand floor, so the pint stays plain text.
      drinkHref: null,
      // The house publisher label for that host (lib/drinks.ts), never the URL.
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
      // The day the publisher's own row was read, which the card prints.
      observedOn: "2026-07-03",
      // lib/priceTier.ts: a published price with a public page inside its window.
      standing: "listed",
      then: {
        priceGbp: 3.6,
        observedOn: "2013-07-14",
        source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
      },
      movementLine: "Up £2.90 in 13 years.",
      mapHref: "/map?sel=venue-eltcmh",
    });
  });

  it("prefers a pub a Londoner knows, then the longest archive span", () => {
    const venues = [
      venue("venue-other", "Other Arms", 5),
      venue("venue-old", "Old Tavern", 5.5),
      venue(defined(LANDING_PUB_PREFERENCE[0]), "The Blackfriar", 6.5),
    ];
    const rows = history([
      { venueId: "venue-other", priceGbp: 4, observedOn: "2018-01-01" },
      { venueId: "venue-old", priceGbp: 2, observedOn: "2009-01-01" },
      { venueId: defined(LANDING_PUB_PREFERENCE[0]), priceGbp: 3.6, observedOn: "2013-07-14" },
    ]);
    expect(buildLandingPubCard(venues, rows, { now: NOW })?.id).toBe(LANDING_PUB_PREFERENCE[0]);
    expect(buildLandingPubCard(venues.slice(0, 2), rows, { now: NOW })?.id).toBe("venue-old");
  });

  it("chooses nothing rather than a pub missing a price or an archive row", () => {
    const rows = history([{ venueId: "venue-a", priceGbp: 3, observedOn: "2014-01-01" }]);
    expect(buildLandingPubCard([venue("venue-a", "Unpriced", null)], rows, { now: NOW })).toBeNull();
    expect(buildLandingPubCard([venue("venue-b", "No archive", 5)], rows, { now: NOW })).toBeNull();
    expect(buildLandingPubCard([], rows, { now: NOW })).toBeNull();
  });

  it("names no publisher when the row carries no page, and the standing falls to none", () => {
    const card = buildLandingPubCard(
      [venue("venue-a", "Quiet Arms", 5, "")],
      history([{ venueId: "venue-a", priceGbp: 3, observedOn: "2014-01-01" }]),
      { now: NOW },
    );
    expect(card?.publisher).toBeNull();
    expect(card?.standing).toBe("none");
  });

  it("lets a listed price expire: past a year the standing is none, the figure still prints", () => {
    // The dataset was collected this summer, but this row was last read in
    // 2024: its own day decides, not the collection day.
    const card = buildLandingPubCard(
      [venue("venue-a", "Old Menu", 5, "https://www.pint-prices.com/pub/x", "2024-01-01T12:00:00Z")],
      history([{ venueId: "venue-a", priceGbp: 3, observedOn: "2014-01-01" }]),
      { now: NOW },
    );
    expect(card?.standing).toBe("none");
    expect(card?.priceGbp).toBe(5);
  });
});
