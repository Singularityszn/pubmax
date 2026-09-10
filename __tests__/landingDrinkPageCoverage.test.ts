import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BEERS } from "@/lib/beers";
import {
  DRINK_BRAND_LANDING_CATALOG,
  DRINK_BRAND_LANDING_PUBLICATION_FLOOR,
  buildDrinkBrandLanding,
} from "@/lib/drinkBrandLanding";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { buildLandingPubCard } from "@/lib/landingPubCard";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

// Astra plan lane 1.5. The landing card printed "£6.50 a pint of Pravha" and
// /drink/pravha answered 404: lib/beers.ts named a brand the drink-brand
// landing family had never heard of. The family now reads every canonical
// draught pint, and the card links a pint to its page only when that page
// publishes, so a brand the card can name is never a door onto a 404.

const DATASET_FILE = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");

function priceRow(venueId: string, pintName: string, price: number): VenuePrice {
  return {
    app_price_id: `${venueId}-${pintName}`,
    app_venue_id: venueId,
    pint_name: pintName,
    price_gbp: price,
    source_url: "https://www.pint-prices.com/pub/x",
    source_row_count: 1,
    has_visible_borough_row: true,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
  } as VenuePrice;
}

function pub(id: string, pintName: string, price: number): Venue {
  return {
    id,
    name: `Pub ${id}`,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    primaryBorough: "City of London",
    kind: "pub",
    prices: [priceRow(id, pintName, price)],
    cheapestPrice: price,
    cheapestPint: pintName,
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

function history(venueId: string) {
  return {
    version: 1,
    generatedAt: "2026-07-27",
    observations: [
      {
        venueId,
        venueName: "Test",
        priceGbp: 3.6,
        observedOn: "2013-07-14",
        source: {
          label: "beerintheevening.com",
          url: "https://www.beerintheevening.com/pubs/x",
          licence: "quoted with attribution",
        },
      },
    ],
  };
}

const NOW = Date.UTC(2026, 8, 10, 12);

describe("every pint the landing card can name has a drink page or no link", () => {
  it("keeps every canonical draught pint in the landing catalogue, lens brands first", () => {
    const ids = DRINK_BRAND_LANDING_CATALOG.map((brand) => brand.id);
    for (const beer of BEERS) {
      expect(ids, `${beer.id} is nameable by the card but unknown to /drink`).toContain(beer.id);
    }
    // The lens catalogue keeps its order and its aliases; lib/beers.ts only
    // fills what it lacks, so no published page changes its rows.
    expect(ids.slice(0, DRINK_BRANDS.beer.length)).toEqual(DRINK_BRANDS.beer.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("walks every nameable brand through the card's own link decision", () => {
    for (const beer of BEERS) {
      const shouted = beer.label.toUpperCase();

      const one = [pub("venue-one", shouted, 5.5)];
      const lonely = buildLandingPubCard(one, history("venue-one"), { collectedOn: "2026-07-03", now: NOW });
      expect(lonely?.pintName).toBe(`a pint of ${beer.label.charAt(0)}${beer.label.slice(1).toLowerCase()}`);
      expect(lonely?.drinkHref, `${beer.id} below the floor must not link`).toBeNull();

      const crowd = Array.from({ length: DRINK_BRAND_LANDING_PUBLICATION_FLOOR }, (_, i) =>
        pub(`venue-${i}`, shouted, 5.5),
      );
      const linked = buildLandingPubCard(crowd, history("venue-0"), { collectedOn: "2026-07-03", now: NOW });
      expect(linked?.drinkHref, `${beer.id} at the floor must link its page`).toBe(
        `/drink/${encodeURIComponent(beer.id)}`,
      );
      expect(buildDrinkBrandLanding(beer.id, crowd)?.slug).toBe(beer.id);
    }
  });

  it("publishes /drink/pravha from the shipped dataset, and links the anchor card to it", async () => {
    const raw = JSON.parse(await readFile(DATASET_FILE, "utf8")) as VenuePrice[];
    const venues = groupVenuePrices(raw);

    const pravha = buildDrinkBrandLanding("pravha", venues);
    expect(pravha).not.toBeNull();
    expect(pravha!.totalPricedVenues).toBeGreaterThanOrEqual(DRINK_BRAND_LANDING_PUBLICATION_FLOOR);

    const published = (await loadDrinkBrandLandings()).map((landing) => landing.slug);
    expect(published).toContain("pravha");

    // A brand the dataset cannot carry stays unpublished, so the sitemap, the
    // static params and the card agree. Kronenbourg had four pubs on 10 Sep 2026.
    for (const beer of BEERS) {
      const landing = buildDrinkBrandLanding(beer.id, venues);
      if (landing) continue;
      const crowd = venues.filter((venue) => venue.cheapestPint?.toLowerCase().includes(beer.label.toLowerCase()));
      for (const venue of crowd.slice(0, 3)) {
        const card = buildLandingPubCard([venue], history(venue.id), { collectedOn: "2026-07-03", now: NOW });
        expect(card?.drinkHref ?? null).toBeNull();
      }
    }
  });
});
