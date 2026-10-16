import { featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import VenuePeekPintPrice, { PEEK_AGING_SUFFIX, peekPriceAging } from "@/components/map/VenuePeekPintPrice";
import type { VenuePriceLane } from "@/lib/venuePriceLane";

import { pricePillFilter } from "@/components/map/canvas/filters";
import { pinPriceAging, pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { AGING_ICON_KEY_SUFFIX, VENUE_PIN_ICON_KEYS } from "@/lib/mapIcons";
import type { Venue } from "@/lib/venues";

// Owner decision 16 Oct 2026: an aging price must look aging, never fresh, on
// the windows the Price Standings own (lib/priceTier.ts): 30 days for a
// drinker's log, 365 for a published price. The pin's colour still carries the
// band alone; the aging pin wears a broken rim and is never a clean pill.

const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);

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
    ...overrides,
  } as Venue;
}


const signal = (over: Partial<VenueSignal> = {}): VenueSignal => ({
  hasPintDrops: false,
  latestContributorPrice: null,
  ...over,
}) as VenueSignal;

function pinFor(venue: Venue, signals?: VenueSignal, lens = false) {
  const map = new Map<string, VenueSignal>(signals ? [[venue.id, signals]] : []);
  const fc = pubsToGeoJSON(
    [venue],
    map,
    null,
    null,
    null,
    null,
    lens ? new Map() : null,
    null,
    null,
    NOW,
  );
  return fc.features[0]!.properties as Record<string, unknown>;
}

describe("a pin's printed price ages on its standing's window", () => {
  it("leaves a listed price read inside a year fresh, with a clean glass", () => {
    const props = pinFor(makeVenue({ cheapestPrice: 4.85, priceObservedAt: isoDay(14) }));
    expect(props.priceLabel).toBe("£4.85");
    expect(props.aging).toBeUndefined();
    expect(String(props.icon)).not.toContain(AGING_ICON_KEY_SUFFIX);
  });

  it("marks a listed price read over a year ago as aging, and keeps its band", () => {
    const fresh = pinFor(makeVenue({ cheapestPrice: 4.85, priceObservedAt: isoDay(14) }));
    const old = pinFor(makeVenue({ cheapestPrice: 4.85, priceObservedAt: isoDay(400) }));
    expect(old.aging).toBe(true);
    expect(old.priceLabel).toBe("£4.85");
    // Same band, same colour: only the rim changes.
    expect(old.bucket).toBe(fresh.bucket);
    expect(old.icon).toBe(`${String(fresh.icon)}${AGING_ICON_KEY_SUFFIX}`);
  });

  it("never lets a price with no read date look fresh", () => {
    expect(pinFor(makeVenue({ cheapestPrice: 4.85 })).aging).toBe(true);
  });

  it("ages a drinker's log on the 30-day clock", () => {
    const venue = makeVenue({ cheapestPrice: 6.2, priceObservedAt: isoDay(2) });
    const recent = pinFor(venue, signal({ latestContributorPrice: 4.5, latestContributorAt: NOW - 2 * DAY }));
    const stale = pinFor(venue, signal({ latestContributorPrice: 4.5, latestContributorAt: NOW - 40 * DAY }));
    expect(recent.priceLabel).toBe("£4.50");
    expect(recent.aging).toBeUndefined();
    expect(stale.priceLabel).toBe("£4.50");
    expect(stale.aging).toBe(true);
  });

  it("says nothing about age on a silent pin or under a lens that owns the figure", () => {
    expect(pinFor(makeVenue({ cheapestPrice: null })).aging).toBeUndefined();
    expect(pinFor(makeVenue({ cheapestPrice: 4.85 }), undefined, true).aging).toBeUndefined();
    expect(
      pinPriceAging({ venue: {}, signals: undefined, sourcedPrice: 4.85, ownsFigure: false, now: NOW }),
    ).toBeNull();
  });

  it("keeps an aging pub off the clean price pill, so its broken rim shows", () => {
    const filter = featureFilter(pricePillFilter(""), "pubs-price-pill.filter").filter;
    const pill = (properties: Record<string, unknown>) =>
      filter({ zoom: 16 }, { type: 1, properties } as never);
    expect(pill({ id: "a", priceLabel: "£4.85" })).toBe(true);
    expect(pill({ id: "a", priceLabel: "£4.85", aging: true })).toBe(false);
  });

  it("registers a broken-rim glass for every glass the map can draw", () => {
    const plain = VENUE_PIN_ICON_KEYS.filter((key) => !key.endsWith(AGING_ICON_KEY_SUFFIX));
    for (const key of plain) expect(VENUE_PIN_ICON_KEYS).toContain(`${key}${AGING_ICON_KEY_SUFFIX}`);
  });
});

describe("the phone peek's price chip", () => {
  const baseline = (observedOn: string | null): VenuePriceLane => ({
    lane: "baseline",
    cheapestPrice: 4.55,
    standing: "none",
    publisher: null,
    observedOn,
  });
  const render = (lane: VenuePriceLane) =>
    renderToStaticMarkup(
      createElement(VenuePeekPintPrice, {
        venueId: "venue-x",
        isPub: true,
        lane,
        bundle: {},
        pintTrust: null,
        detailLoading: false,
        priceReadStatus: "ready",
        dropReadStatus: "ready",
        onLog: () => {},
      }),
    );

  it("breaks the chip's edge and says so when the price on record has no read date", () => {
    expect(peekPriceAging(baseline(null))).toBe(true);
    const html = render(baseline(null));
    expect(html).toContain("priceBadge--aging");
    expect(html).toContain(PEEK_AGING_SUFFIX.trim());
  });

  it("leaves a price read this year clean", () => {
    const fresh = new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10);
    expect(peekPriceAging(baseline(fresh))).toBe(false);
    const html = render(baseline(fresh));
    expect(html).not.toContain("priceBadge--aging");
    expect(html).not.toContain(PEEK_AGING_SUFFIX.trim());
  });
});
