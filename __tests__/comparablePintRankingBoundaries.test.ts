import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { rankConciergeVenues, type ConciergeVenue } from "@/lib/concierge/rank";
import { buildLandingAnchorRail, buildLandingPubCard } from "@/lib/landingPubCard";
import { buildLondonCollageAreaPrices, LONDON_COLLAGE_PHOTOS } from "@/lib/landingLondonCollage";
import { tonightCheapestAnswer, type TonightCheapestCandidate } from "@/lib/tonightAnswers";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

const NOW = new Date("2026-11-01T12:00:00Z");
const evidence = { priceSource: "Pub menu", priceObservedAt: "2026-10-01" };
const rejected = [
  { anchorLabel: "Half pint house lager" },
  { priceSource: undefined },
  { priceObservedAt: undefined },
  { priceObservedAt: "2026-01" },
  { priceObservedAt: "2026-02-30" },
  { priceObservedAt: "2027-01-01" },
  { cheapestPrice: 0 },
  { cheapestPrice: Number.NaN },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

function venue(id: string, price: number, extra: Partial<Venue> = {}): Venue {
  return {
    id, name: id, latitude: 51.5136, longitude: -0.1365,
    primaryBorough: "Westminster", cheapestPrice: price,
    prices: [{ price_gbp: price, pub_url: "https://pub.example/menu", scraped_at_values: "2026-10-01" }],
    ...evidence, ...extra,
  } as Venue;
}

function concierge(id: string, extra: Partial<ConciergeVenue> = {}): ConciergeVenue {
  return {
    id, name: id, area: "Soho", lat: 51.5136, lng: -0.1365,
    cheapestPrice: 5, ...evidence,
    amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false, hasStory: false, canonical: true, ...extra,
  };
}

describe("the captain's comparable-pint contract at ranking boundaries", () => {
  it.each(rejected)("Tonight refuses %j for both position and remembered-area answers", (change) => {
    const near = { lat: 51.5136, lng: -0.1365 };
    const nearby: TonightCheapestCandidate[] = [
      { id: "rejected", name: "Rejected", ...near, cheapestPrice: 2.49, ...evidence, ...change },
      { id: "pint", name: "Pint", ...near, cheapestPrice: 5, ...evidence },
    ];
    for (const location of [{ origin: near, patch: null }, { origin: null, patch: { label: "Soho", near } }]) {
      expect(tonightCheapestAnswer({ ...location, nearby, cityRows: [] })).toMatchObject({ venueId: "pint", priceGbp: 5 });
      expect(tonightCheapestAnswer({ ...location, nearby: nearby.slice(0, 1), cityRows: [] })).toBeNull();
    }
  });

  it.each(rejected)("concierge gives no pint-price advantage to %j and keeps the pub discoverable", (change) => {
    const invalid = concierge("rejected", { cheapestPrice: 2.49, ...change });
    for (const { budget, pintScore, refusedScore } of [
      { budget: {}, pintScore: 4, refusedScore: 1 },
      { budget: { maxPintPrice: 6 }, pintScore: 12, refusedScore: -1 },
    ]) {
      const intent = { mood: [], groupSize: 2, ...budget };
      const rows = rankConciergeVenues([invalid, concierge("pint")], intent);
      expect(rows.map((row) => row.venue.id)).toEqual(["pint", "rejected"]);
      expect(rows[0]?.score).toBe(pintScore);
      expect(rows[1]?.score).toBe(refusedScore);
      expect(rows[1]?.reasons).toEqual([]);
    }
  });

  it.each(rejected)("the landing card, rail and photo prices refuse %j", (change) => {
    const venues = [venue("rejected", 2.49, change), venue("pint", 5)];
    const history = {
      version: 1,
      observations: venues.map((pub) => ({
        venueId: pub.id, venueName: pub.name, priceGbp: 2, observedOn: "2015-01-01", quote: "£2 a pint",
        source: { label: "Archive", url: "https://archive.example/pub", licence: "quoted" },
      })),
    };
    expect(buildLandingPubCard(venues, history, { now: NOW.getTime() })).toMatchObject({ id: "pint", priceGbp: 5 });
    expect(buildLandingAnchorRail(venues, { id: "anchor", primaryBorough: "Westminster" }, {}).map((row) => row.id)).toEqual(["pint"]);
    const photo = { ...defined(LONDON_COLLAGE_PHOTOS[0]), area: "test", spot: [51.5136, -0.1365] as const };
    expect(buildLondonCollageAreaPrices(venues, [photo])).toEqual({ test: { cheapestPrice: 5, pubName: "pint", pubCount: 1 } });
    expect(venues[0]?.cheapestPrice).toBe(change.cheapestPrice ?? 2.49);
  });

  it.each(["2026-01", "2026-02-30", "2026-02-30T12:00:00Z", "2027-01-01"])("retains a venue with original date %s but gives it no comparable pint", (scraped_at_values) => {
    const [pub] = groupVenuePrices([{
      pub_name: "The Test Arms", address: "1 Test Street", latitude: 51.5, longitude: -0.1,
      primary_borough: "Camden", pint_name: "Lager", price_gbp: 3,
      pub_url: "https://pub.example/menu", scraped_at_values,
    } as VenuePrice]);
    expect(pub).toMatchObject({ name: "The Test Arms", cheapestPrice: 3 });
    expect(defined(pub).prices[0]?.scraped_at_values).toBe(scraped_at_values);
    expect(comparableVenuePint(defined(pub))).toBeNull();
  });
});
