import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { rankConciergeVenues, type ConciergeVenue } from "@/lib/concierge/rank";
import { buildLandingAnchorRail, buildLandingPubCard } from "@/lib/landingPubCard";
import { buildLondonCollageAreaPrices, LONDON_COLLAGE_PHOTOS } from "@/lib/landingLondonCollage";
import { tonightCheapestAnswer, type TonightCheapestCandidate } from "@/lib/tonightAnswers";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";
import { boroughsWithPrices, pricedWithinWalk, rankBoroughCheapest, rankCityCheapest, rankNearMe, venueToPricedPoint } from "@/lib/nearMeAnswer";
import { nearPintRows } from "@/lib/nearCheapestAnything";
import { pinsToSlimVenues, slimVenueToPin } from "@/lib/slimPins";
import { buildMapVenueListModel, mapVenueListCheapest } from "@/lib/mapVenueList";
import { mapSplitListPrice } from "@/lib/mapSplitList";
import { cheapestDrinksNearPoint } from "@/lib/areaButton";
import { isSourcedPint } from "@/scripts/build_last_orders_pack.mjs";
import { selectCheapPintPing } from "@/lib/cheapPintPingSelect.server";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { readCityVenueIndex } from "@/lib/venueIndex";
import { getCity } from "@/lib/cities";
import { loadSlimVenuesFromPath, type SlimVenue } from "@/lib/venuesSlim";
import { mergePriceUpdates } from "@/lib/priceUpdates";

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
  { cheapestPint: "BOTTLED BEER" },
  { cheapestPint: "Half pint lager" },
  { cheapestPint: "Half-pint lager" },
  { cheapestPint: "half_pint lager" },
  { cheapestPint: "2 halves of stout" },
  { measure: "bottle" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it.each(rejected)("Near me projections refuse %j across all answer modes", (change) => {
    const points = [venue("rejected", 2.49, change), venue("pint", 5)].map(venueToPricedPoint);
    expect(rankNearMe(51.5136, -0.1365, points).cards.map((card) => card.id)).toEqual(["pint"]);
    expect(rankBoroughCheapest(points, "Westminster").map((card) => card.id)).toEqual(["pint"]);
    expect(rankCityCheapest(points).map((card) => card.id)).toEqual(["pint"]);
    expect(boroughsWithPrices(points.slice(0, 1))).toEqual([]);
    expect(pricedWithinWalk(51.5136, -0.1365, points)).toEqual([5]);
    expect(nearPintRows(points).map((row) => row[0])).toEqual(["pint"]);
    expect(points).toHaveLength(2);
  });

  it.each(["BOTTLED BEER", "Half pint lager", "Half-pint lager", "half_pint lager", "2 halves of stout", "330ml Lager"])("keeps a listed %s visible through slim pins and map answers", (cheapestPint) => {
    const rows = [
      { id: "rejected", name: "Rejected", lat: 51.5136, lng: -0.1365, cheapestPrice: 2.49, cheapestPint, borough: "Westminster", ...evidence },
      { id: "pint", name: "Pint", lat: 51.5136, lng: -0.1365, cheapestPrice: 5, cheapestPint: "Lager", borough: "Westminster", ...evidence },
    ];
    const pins = rows.map(slimVenueToPin);
    const restored = pinsToSlimVenues(pins).map(slimVenueToPin);
    for (const pubs of [pins, restored]) {
      expect(mapVenueListCheapest(pubs)?.venue.id).toBe("pint");
      expect(buildMapVenueListModel(pubs, null, 10, null, "Pint", "ready", "cheapest").rows.map((row) => row.id)).toEqual(["pint", "rejected"]);
      expect(cheapestDrinksNearPoint([-0.1365, 51.5136], pubs).map((row) => row.id)).toEqual(["pint", "rejected"]);
      expect(mapSplitListPrice(defined(pubs[0]), undefined)).toMatchObject({ rankGbp: null });
      expect(mapSplitListPrice(defined(pubs[1]), undefined)).toMatchObject({ rankGbp: 5 });
      expect(pubs[0]).toMatchObject({ cheapestPrice: 2.49, cheapestPint });
    }
    expect(isSourcedPint(rows[0])).toBe(false);
    expect(isSourcedPint(rows[1])).toBe(true);
  });

  it("uses the first selected legacy row's serving on a price tie", () => {
    const [pub] = groupVenuePrices([
      { pub_name: "Test", address: "1 Test Street", latitude: 51.5136, longitude: -0.1365, primary_borough: "Westminster", pint_name: "BOTTLED BEER", price_gbp: 3, pub_url: "https://pub.example/menu", scraped_at_values: "2026-10-01" } as VenuePrice,
      { pub_name: "Test", address: "1 Test Street", latitude: 51.5136, longitude: -0.1365, primary_borough: "Westminster", pint_name: "Lager", price_gbp: 3, pub_url: "https://pub.example/menu", scraped_at_values: "2026-10-02" } as VenuePrice,
    ]);
    expect(pub).toMatchObject({ cheapestPrice: 3, cheapestPint: "BOTTLED BEER" });
    expect(comparableVenuePint(defined(pub))).toBeNull();
    expect(rankCityCheapest([venueToPricedPoint(defined(pub))])).toEqual([]);
  });

  it("keeps the published TânVân bottle visible while refusing it in server and map answers", async () => {
    const published = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")) as { rows: SlimVenue[] };
    const bottle = defined(published.rows.find((row) => row.id === "venue-16crofi"));
    expect(bottle).toMatchObject({ cheapestPrice: 5, cheapestPint: "BOTTLED BEER" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ rows: [bottle, { ...bottle, id: "measure-only", cheapestPint: "Lager", measure: "bottle" }] }))));
    const loadedRows = await loadSlimVenuesFromPath("/data/comparable-pint-regression.json");
    const normalized = defined(loadedRows[0]);
    expect(normalized).toMatchObject({ cheapestPrice: 5, cheapestPint: "BOTTLED BEER" });
    expect(comparableVenuePint(slimVenueToPin(normalized))).toBeNull();
    expect(comparableVenuePint(slimVenueToPin(defined(loadedRows[1])))).toBeNull();
    const pint = { ...bottle, id: "pint", name: "Pint", cheapestPrice: 6, cheapestPint: "Lager" };
    const points = [bottle, pint].map(slimVenueToPin).map(venueToPricedPoint);
    expect(rankNearMe(bottle.lat, bottle.lng, points).cards.map((row) => row.id)).toEqual(["pint"]);
    expect(tonightCheapestAnswer({ origin: { lat: bottle.lat, lng: bottle.lng }, patch: null, nearby: [bottle, pint], cityRows: [] })).toMatchObject({ venueId: "pint" });
    expect(isSourcedPint(bottle)).toBe(false);
    const index = await readCityVenueIndex(getCity("london"));
    const indexed = defined(index?.get(bottle.id)).slimVenue;
    expect(indexed).toMatchObject({ cheapestPrice: 5, cheapestPint: "BOTTLED BEER", priceSource: "Pint Prices" });
    expect(comparableVenuePint(slimVenueToPin(indexed))).toBeNull();
    const loaded = defined((await loadConciergeVenues("london")).find((row) => row.id === bottle.id));
    expect(loaded).toMatchObject({ cheapestPrice: 5, cheapestPint: "BOTTLED BEER" });
    expect(rankConciergeVenues([loaded, concierge("pint", { cheapestPrice: 6 })], { mood: [], groupSize: 2 })[0]?.venue.id).toBe("pint");
  });

  it("keeps a corroborated pint separate from an old bottle's serving and evidence", () => {
    const pub = venue("pint", 4, {
      cheapestPint: "Lager", measure: "bottle", anchorLabel: "Bottle",
      latestContributorPrice: 4, latestContributorAt: "2026-10-31T12:00:00Z",
      prices: [{ price_gbp: 5, pint_name: "BOTTLED BEER" } as VenuePrice],
    });
    expect(comparableVenuePint(pub)).toBe(4);
    expect(venueToPricedPoint(pub)).toMatchObject({ priceSource: "Corroborated Pint Drop", priceObservedAt: "2026-10-31T12:00:00Z" });
    expect(rankCityCheapest([venueToPricedPoint(pub)]).map((row) => row.id)).toEqual(["pint"]);
  });

  it("uses a sourced pint update's own evidence instead of the replaced baseline serving", () => {
    const baseline = venue("pint", 5, { cheapestPint: "BOTTLED BEER", measure: "bottle", latestContributorAt: null });
    const [updated] = mergePriceUpdates([baseline], [{ venueKey: "test", price: 4, source: { label: "Fresh menu", url: "https://pub.example/menu" }, observedAt: "2026-10-31" }], () => "test");
    expect(comparableVenuePint(defined(updated))).toBe(4);
    const point = venueToPricedPoint(defined(updated));
    expect(point).toMatchObject({ priceSource: "Fresh menu", priceObservedAt: "2026-10-31", cheapestPrice: 4 });
    expect(rankCityCheapest([point]).map((row) => row.id)).toEqual(["pint"]);
  });

  it.each([
    { cheapestPint: "BOTTLED BEER" },
    { measure: "bottle" },
    { scraped_at_values: "2026-01" },
    { scraped_at_values: "2026-02-30" },
  ])("ping selection refuses %j from the selected legacy record", async (change) => {
    const invalid = venue("rejected", 2.49, {
      priceSource: undefined, priceObservedAt: undefined,
      prices: [{ price_gbp: 2.49, pint_name: change.cheapestPint ?? "Lager", measure: "measure" in change ? change.measure : undefined, scraped_at_values: "scraped_at_values" in change ? change.scraped_at_values : "2026-10-01", pub_url: "https://pub.example/menu" } as VenuePrice],
    });
    const result = await selectCheapPintPing("profile:test", "account-test", {
      nightAreaForAccount: async () => "piccadilly-soho",
      listPricedVenues: async () => [invalid, venue("pint", 5)],
    });
    expect(result).toMatchObject({ venueId: "pint", priceLabel: "£5.00" });
  });
});
