import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DrinkMenu from "@/components/drinks/DrinkMenu";
import VenueOverviewTab from "@/components/map/inspector/VenueOverviewTab";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import type { Drink } from "@/lib/drinks";
import type { Venue, VenuePrice } from "@/lib/venues";

const noop = () => {};
const OBSERVED = "2026-07-01T12:00:00.000Z";

function drink(source: string, sourceUrl?: string): Drink {
  return {
    id: `beer-${source}`,
    category: "beer",
    name: "Test Lager",
    priceGbp: 6.4,
    provenance: {
      source,
      sourceUrl,
      licence: "first-party",
      observedAt: OBSERVED,
    },
  };
}

function price(pubUrl: string): VenuePrice {
  return {
    app_price_id: "price-1",
    pub_name: "The Test Arms",
    pint_name: "Test Lager",
    price_gbp: 6.4,
    price_text: "£6.40",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: pubUrl,
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
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
  };
}

function venue(pubUrl: string): Venue {
  return {
    id: "venue-test",
    name: "The Test Arms",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.12,
    primaryBorough: "Camden",
    visibleBoroughs: ["Camden"],
    prices: [price(pubUrl)],
    cheapestPrice: 6.4,
    cheapestPint: "Test Lager",
    averagePrice: 6.4,
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
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    kind: "pub",
  };
}

function communityPrices(venueId: string): CommunityPricesState {
  return {
    byVenueId: new Map([[venueId, []]]),
    signalsByVenueId: new Map(),
    freshestByVenueId: new Map(),
    noAlcoholIndexStatus: "idle",
    loadNoAlcoholIndex: noop,
    loadDrinkCategoryIndex: noop,
    drinkCategoryIndexStatus: new Map(),
    provisionalBaseVenueIds: new Set(),
    loadProvisionalBaseVenues: noop,
    loadVenue: noop,
    venuePriceStatus: new Map([[venueId, "ready"]]),
    submit: async () => ({
      ok: true,
      attribution: { status: "anonymous" },
    }),
    submitVenueSignal: async () => ({ ok: true }),
    submitting: false,
    reportPrice: noop,
    reportedIds: new Set(),
  };
}

function renderOverview(pubUrl: string): string {
  const currentVenue = venue(pubUrl);
  return renderToStaticMarkup(
    createElement(VenueOverviewTab, {
      venue: currentVenue,
      tab: "overview",
      cityId: "london",
      mode: "suggest",
      inCrawl: false,
      latestContributorPrice: null,
      communityPrices: communityPrices(currentVenue.id),
      experienceLens: "all",
      onToggleStop: noop,
      presenceState: "idle",
      markPresenceHere: noop,
      userLocation: null,
      locationRequestStatus: "idle",
      onRequestLocation: noop,
      onClearLocation: noop,
      onStartFirstDrop: noop,
      priceEntryAllowed: false,
      priceSignInRequested: false,
      priceAuthLoading: false,
      priceFocusRequest: 0,
    }),
  );
}

describe("baseline price-source presentation", () => {
  it("labels an unattributed drink price beside the figure", () => {
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [drink("app-dataset")],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain("£6.40");
    expect(html).toContain("Publisher not recorded");
    expect(html).toContain(
      "the price is on record but its publisher was not captured",
    );
    expect(html).not.toContain(">On record<");
  });

  it("keeps a named publisher linked without an unattributed label", () => {
    const sourceUrl = "https://www.pint-prices.com/pub/the-test-arms";
    const html = renderToStaticMarkup(
      createElement(DrinkMenu, {
        drinks: [drink("Pint Prices", sourceUrl)],
        venueName: "The Test Arms",
      }),
    );

    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain(">Pint Prices</a>");
    expect(html).not.toContain("Publisher not recorded");
  });

  it("states the missing publisher beside an Overview baseline price", () => {
    const html = renderOverview("");

    expect(html).toContain("£6.40");
    expect(html).toContain(
      "Price on record. Publisher not recorded for this price.",
    );
    expect(html).not.toContain("Source not named in record");
  });

  it("keeps the Overview publisher link when the price record names one", () => {
    const sourceUrl = "https://www.pint-prices.com/pub/the-test-arms";
    const html = renderOverview(sourceUrl);

    expect(html).toContain(`href="${sourceUrl}"`);
    expect(html).toContain(">Pint Prices</a>");
    expect(html).not.toContain("Publisher not recorded for this price");
  });
});
