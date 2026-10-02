import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { BEERS } from "@/lib/beers";
import { seedCrawlState } from "@/lib/crawlUrl";
import { DEFAULT_DRINK_LANE, activeDrinkLane } from "@/lib/drinkLanes";
import {
  DRINK_BRAND_LANDING_CATALOG,
  DRINK_BRAND_LANDING_PUBLICATION_FLOOR,
  buildDrinkBrandLanding,
} from "@/lib/drinkBrandLanding";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { isMapLensDrinkCategory } from "@/lib/drinks";
import { filterMapVenues } from "@/lib/filterMapVenues";
import { buildLandingPubCard } from "@/lib/landingPubCard";
import { filtersForDrinkPriceLens } from "@/lib/mapExperienceLens";
import { pricedLandingMapHref } from "@/lib/pricedLanding";
import { mapDrinkLensSelection } from "@/lib/pubMap";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

// Astra plan lane 1.5. The landing card printed "£6.50 a pint of Pravha" and
// /drink/pravha answered 404: lib/beers.ts named a brand the drink-brand
// landing family had never heard of. The family now reads every canonical
// draught pint, and the card links a pint to its page only when that page
// publishes, so a brand the card can name is never a door onto a 404.

const DATASET_FILE = path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json");
const SLIM_FILE = path.join(process.cwd(), "public", "data", "venues_slim.json");

function priceRow(venueId: string, pintName: string, price: number): VenuePrice {
  return {
    app_price_id: `${venueId}-${pintName}`,
    pub_name: `Pub ${venueId}`,
    pint_name: pintName,
    price_gbp: price,
    price_text: `£${price}`,
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "City of London",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "City of London",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "https://www.pint-prices.com/pub/x",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
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
      const lonely = buildLandingPubCard(one, history("venue-one"), { now: NOW });
      expect(lonely?.pintName).toBe(`a pint of ${beer.label.charAt(0)}${beer.label.slice(1).toLowerCase()}`);
      expect(lonely?.drinkHref, `${beer.id} below the floor must not link`).toBeNull();

      const crowd = Array.from({ length: DRINK_BRAND_LANDING_PUBLICATION_FLOOR }, (_, i) =>
        pub(`venue-${i}`, shouted, 5.5),
      );
      const linked = buildLandingPubCard(crowd, history("venue-0"), { now: NOW });
      expect(linked?.drinkHref, `${beer.id} at the floor must link its page`).toBe(
        `/drink/${encodeURIComponent(beer.id)}`,
      );
      expect(buildDrinkBrandLanding(beer.id, crowd)?.slug).toBe(beer.id);
    }
  });

  it("does not link a pint the page's own matcher would not list", () => {
    const crowd = Array.from({ length: DRINK_BRAND_LANDING_PUBLICATION_FLOOR }, (_, i) =>
      pub(`venue-hells-${i}`, "CAMDEN HELLS", 5.5),
    );
    const paleAle = pub("venue-pale", "CAMDEN PALE ALE", 5.2);
    const venues = [paleAle, ...crowd];

    expect(buildDrinkBrandLanding("camden-hells", venues)?.rows.map((row) => row.venueId)).not.toContain(
      "venue-pale",
    );

    const card = buildLandingPubCard(venues, history("venue-pale"), { now: NOW });
    expect(card?.pintName).toBe("a pint of Camden pale ale");
    expect(card?.drinkHref).toBeNull();
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
        const card = buildLandingPubCard([venue], history(venue.id), { now: NOW });
        expect(card?.drinkHref ?? null).toBeNull();
      }
    }
  });
});

// Astra plan lane 1.5, second half. A published page's primary action is
// `/map?brand=<slug>`, and the arrival has to show that brand's pubs. Deciding
// the brand is not enough: the map paints SLIM pins, which carry no price rows,
// so a brand the filter cannot see on a pin empties the map instead of
// repricing it.
//
// public/data/venues_slim.json is the generated artifact the map actually
// fetches, so the fence reads it and runs the real pin pipeline over it.
async function londonMapPins(): Promise<Venue[]> {
  const payload = JSON.parse(await readFile(SLIM_FILE, "utf8")) as unknown;
  const rows = (rowsFromSlimPayload(payload) ?? []) as SlimVenue[];
  return slimVenuesToPins(rows);
}

// The filters PubMap hands filterMapVenues for this arrival: the URL seed,
// then the drink-price lens, which stands brand refinements down for a
// non-beer lens and leaves them alone for beer.
function arrivalFilters(brandSlug: string) {
  const href = pricedLandingMapHref({ brandSlug });
  const seeded = seedCrawlState(href.slice(href.indexOf("?")));
  const { mapDrinkLensCategory } = mapDrinkLensSelection({
    drinkCategory: seeded.filters.drinkCategory,
    experienceLens: "all",
    isMapLensDrinkCategory,
    activeDrinkLane,
    defaultDrinkLane: DEFAULT_DRINK_LANE,
  });
  return {
    seeded,
    effective: filtersForDrinkPriceLens(seeded.filters, mapDrinkLensCategory),
  };
}

describe("the map arrival every published drink page offers", () => {
  it("shows that brand's pubs, for every page the shipped dataset publishes", async () => {
    const pins = await londonMapPins();
    expect(pins.length).toBeGreaterThan(0);

    for (const { slug, brandLabel } of await loadDrinkBrandLandings()) {
      const { seeded, effective } = arrivalFilters(slug);
      expect(seeded.filters.drinkBrand, `${brandLabel} arrives on an unrepriced map`).toBe(slug);

      const shown = filterMapVenues(pins, effective, () => false);
      expect(shown.length, `${brandLabel} arrives on an empty map`).toBeGreaterThan(0);
    }
  });

  it("narrows the map rather than passing every pin through", async () => {
    // A brand filter that matched everything would satisfy the count above
    // without repricing anything.
    const pins = await londonMapPins();
    const shown = filterMapVenues(pins, arrivalFilters("pravha").effective, () => false);

    expect(shown.length).toBeLessThan(pins.length);
    for (const pin of shown) {
      expect(pin.filterHints?.drinkText ?? "").toContain("pravha");
    }
  });

  it("seeds the favourite pint from a bare beer deep-link", () => {
    // The same condition PubMap reads to seed favoritePint from the URL.
    const seeded = seedCrawlState("?brand=pravha");
    expect(seeded.filters.drinkCategory === "beer" && seeded.filters.drinkBrand).toBe("pravha");
  });

  it("keeps the lens catalogue in front, so its own aliases still decide", () => {
    // camden-hells is in BOTH catalogues; the lens row owns the id.
    const seeded = seedCrawlState("?brand=camden-hells");
    expect(seeded.filters.drinkBrand).toBe("camden-hells");
    expect(seeded.filters.drinkCategory).toBe("beer");
    // A non-beer lens brand keeps its own category rather than becoming a beer.
    expect(seedCrawlState("?brand=sipsmith").filters.drinkCategory).toBe("gin");
  });
});
