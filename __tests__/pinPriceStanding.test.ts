// The pin's half of the standing contract: what an estimate may put on the map,
// and every lane it may not reach.

import { describe, expect, it } from "vitest";

import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { priceStandingFor, type PriceStandingDecision } from "@/lib/priceTier";
import type { Venue } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "venue-1",
    name: "The Test Arms",
    address: "Somewhere",
    latitude: 51.5,
    longitude: -0.1,
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
      food: false, cocktails: false, beerGarden: false, liveSports: false,
      liveMusic: false, pubQuiz: false, darts: false, pool: false,
      happyHour: false, karaoke: false, nonAlcoholic: false,
    },
    website: "",
    bookingLink: "",
    imageUrl: "",
    description: "",
    dataQualityNotes: [],
    sourceDatasets: [],
    curation: {},
    ...overrides,
  } as Venue;
}

const NOW = Date.parse("2026-09-03T12:00:00.000Z");
const estimateDecision = (priceGbp: number): PriceStandingDecision =>
  priceStandingFor(
    { estimate: { priceGbp, basis: "regional_baseline", sampleSize: 40, computedAt: "2026-09-01T00:00:00.000Z" } },
    NOW,
  );

const signals = new Map<string, VenueSignal>();
const build = (venues: Venue[], standings: Map<string, PriceStandingDecision> | null) =>
  pubsToGeoJSON(venues, signals, null, null, null, null, null, standings).features;

describe("a pin's price standing", () => {
  it("changes nothing at all when no standings are passed", () => {
    const venue = makeVenue({ cheapestPrice: 5.4 });
    const [withoutArg] = build([venue], null);
    expect(defined(withoutArg).properties).not.toHaveProperty("standing");
    expect(defined(withoutArg).properties?.priceLabel).toBe("£5.40");
  });

  it("prints a modelled figure as est. on a pub that has no price of its own", () => {
    const [feature] = build([makeVenue({ cheapestPrice: null })], new Map([["venue-1", estimateDecision(6.6)]]));
    expect(defined(feature).properties?.priceLabel).toBe("est. £6.60");
    expect(defined(feature).properties?.standing).toBe("estimate");
  });

  it("never displaces a price the pub can stand behind", () => {
    const [feature] = build([makeVenue({ cheapestPrice: 5.4 })], new Map([["venue-1", estimateDecision(6.6)]]));
    expect(defined(feature).properties?.priceLabel).toBe("£5.40");
  });

  it("never moves the colour band, because a band is the price stack's answer", () => {
    const bare = defined(build([makeVenue({ cheapestPrice: null })], null)[0]);
    const estimated = defined(build(
      [makeVenue({ cheapestPrice: null })],
      new Map([["venue-1", estimateDecision(6.6)]]),
    )[0]);
    expect(estimated.properties?.bucket).toBe(bare.properties?.bucket);
  });

  it("stays silent under a drink lens, whose promise is a corroborated category price", () => {
    const venue = makeVenue({ cheapestPrice: null });
    const [feature] = pubsToGeoJSON(
      [venue],
      signals,
      null,
      "wine",
      null,
      null,
      new Map(),
      new Map([["venue-1", estimateDecision(6.6)]]),
    ).features;
    expect(defined(feature).properties?.priceLabel).toBeUndefined();
    expect(defined(feature).properties?.standing).toBe("estimate");
  });

  it("carries the standing on a listed pub without touching its figure", () => {
    const listed = priceStandingFor(
      { listed: { priceGbp: 5.4, sourceUrl: "https://pub.example/menu", observedAt: "2026-08-20T00:00:00.000Z" } },
      NOW,
    );
    const [feature] = build([makeVenue({ cheapestPrice: 5.4 })], new Map([["venue-1", listed]]));
    expect(defined(feature).properties?.standing).toBe("listed");
    expect(defined(feature).properties?.priceLabel).toBe("£5.40");
  });

  it("puts no label on a pub whose standing is none", () => {
    const [feature] = build([makeVenue({ cheapestPrice: null })], new Map([["venue-1", priceStandingFor({}, NOW)]]));
    expect(defined(feature).properties?.priceLabel).toBeUndefined();
    expect(defined(feature).properties?.standing).toBe("none");
  });
});
