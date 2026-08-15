import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { haversineKm } from "@/lib/haversine";
import {
  NIGHT_AREA_LANDING_PRICE_FLOOR,
  assignVenueToNightArea,
  buildNightAreaLanding,
  listNightAreaLandings,
  nightAreaPricePublisher,
} from "@/lib/nightAreaLanding";
import { NIGHT_AREAS, getNightArea, type NightArea } from "@/lib/nightAreas";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const NOW = new Date("2026-08-15T12:00:00.000Z");

async function realVenues(): Promise<Venue[]> {
  const raw = await readFile(
    path.join(process.cwd(), "public", "data", "pint_prices_app_dataset.json"),
    "utf8",
  );
  return groupVenuePrices(JSON.parse(raw) as VenuePrice[]);
}

function venueAt(id: string, lat: number, lng: number): Venue {
  return {
    id,
    name: id,
    address: "",
    latitude: lat,
    longitude: lng,
    primaryBorough: "",
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
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: { heritageNote: "", vibeTags: [], staffPick: false },
  } as Venue;
}

function pricedVenue(id: string, price: number, area: NightArea): Venue {
  const row = {
    app_price_id: `price-${id}`,
    pub_name: id,
    pint_name: "Lager",
    price_gbp: price,
    pub_url: `https://www.pint-prices.com/pub/${id}`,
  } as VenuePrice;
  return {
    ...venueAt(id, area.centre.lat, area.centre.lng),
    prices: [row],
    cheapestPrice: price,
    cheapestPint: row.pint_name,
  };
}

describe("Night Area landing assignment", () => {
  it("assigns a Venue to the nearest containing area across the full catalogue", () => {
    const clapham = getNightArea("clapham");
    const brixton = getNightArea("brixton");
    const venue = venueAt(
      "overlap",
      (clapham.centre.lat + brixton.centre.lat) / 2,
      (clapham.centre.lng + brixton.centre.lng) / 2,
    );
    const expected = [clapham, brixton]
      .map((area) => ({
        area,
        distance: haversineKm(
          [venue.longitude, venue.latitude],
          [area.centre.lng, area.centre.lat],
        ),
      }))
      .sort((left, right) => left.distance - right.distance || left.area.slug.localeCompare(right.area.slug))[0]!.area;

    expect(assignVenueToNightArea(venue, NIGHT_AREAS)?.slug).toBe(expected.slug);
  });

  it("returns no assignment outside every area radius", () => {
    expect(assignVenueToNightArea(venueAt("far-away", 55, -3), NIGHT_AREAS)).toBeNull();
  });

  it("breaks an exact distance tie by slug", () => {
    const base = getNightArea("clapham");
    const later = { ...base, slug: "victoria" as const };
    const earlier = { ...base, slug: "clapham" as const };

    expect(assignVenueToNightArea(
      venueAt("tie", base.centre.lat, base.centre.lng),
      [later, earlier],
    )?.slug).toBe("clapham");
  });
});

describe("Night Area landing governance", () => {
  it("publishes exactly the four current pages with dataset-derived priced-pub counts", async () => {
    const landings = listNightAreaLandings(await realVenues(), NIGHT_AREAS, NOW);

    expect(Object.fromEntries(landings.map((landing) => [landing.slug, landing.pricedPubCount]))).toEqual({
      clapham: 35,
      victoria: 41,
      "piccadilly-soho": 72,
      "canary-wharf": 13,
    });
    expect(landings.flatMap((landing) => landing.prices).every(
      (row) => row.publisher?.name === "Pint Prices",
    )).toBe(true);
  });

  it("binds every ranked figure to its exact cheapest row and named publisher", async () => {
    const landing = buildNightAreaLanding(
      getNightArea("victoria"),
      await realVenues(),
      NIGHT_AREAS,
      NOW,
    );

    expect(landing).not.toBeNull();
    expect(landing!.prices[0]).toMatchObject({
      rank: 1,
      venueName: "The Willow Walk - JD Wetherspoon",
      priceGbp: 4.39,
      pintName: expect.any(String),
      publisher: {
        name: "Pint Prices",
        url: expect.stringMatching(/^https:\/\/www\.pint-prices\.com\/pub\//),
      },
    });
    expect(landing!.prices.every((row) => row.publisher?.name === "Pint Prices")).toBe(true);
    expect(landing!.prices.map((row) => row.rank)).toEqual(
      Array.from({ length: landing!.prices.length }, (_, index) => index + 1),
    );
  });

  it("maps only the exact price row source and leaves unknown publishers unclaimed", () => {
    expect(nightAreaPricePublisher({ pub_url: "https://www.pint-prices.com/pub/a" } as VenuePrice)).toEqual({
      name: "Pint Prices",
      url: "https://www.pint-prices.com/pub/a",
    });
    expect(nightAreaPricePublisher({ pub_url: "https://example.com/pub/a" } as VenuePrice)).toBeNull();
    expect(nightAreaPricePublisher({ pub_url: "not-a-url" } as VenuePrice)).toBeNull();
  });

  it("fails closed when a review expires or priced coverage drops below the floor", () => {
    const area = getNightArea("clapham");
    const enough = Array.from(
      { length: NIGHT_AREA_LANDING_PRICE_FLOOR },
      (_, index) => pricedVenue(`venue-${index}`, 4 + index / 100, area),
    );

    expect(buildNightAreaLanding(area, enough, [area], NOW)).not.toBeNull();
    expect(buildNightAreaLanding(area, enough.slice(1), [area], NOW)).toBeNull();
    expect(buildNightAreaLanding(area, enough, [area], new Date("2027-01-02T00:00:00.000Z"))).toBeNull();
  });
});
