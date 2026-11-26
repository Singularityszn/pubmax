import { describe, it, expect } from "vitest";

import { pinsToSlimVenues, slimVenueToPin, slimVenuesToPins } from "@/lib/slimPins";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import type { SlimVenue } from "@/lib/venuesSlim";
import { fairPence } from "@/lib/fairPintPricing";

const slim: SlimVenue = {
  id: "venue-abc123",
  name: "The Prospect of Whitby",
  lat: 51.509,
  lng: -0.0498,
  cheapestPrice: 5.2,
  borough: "Tower Hamlets",
  locality: "Wapping",
  filterHints: {
    searchText: "prospect of whitby wine",
    amenities: {
      food: true,
      cocktails: true,
      beerGarden: false,
      liveSports: false,
      nonAlcoholic: true,
    },
    curation: {
      nearWater: true,
      hasStory: true,
    },
    canonical: true,
  },
};

describe("slimVenueToPin", () => {
  it("carries documented London accessibility before detail hydrates", () => {
    expect(slimVenueToPin({ ...slim, name: "The Ice Wharf - JD Wetherspoon", borough: "Camden" }).accessibility?.stepFree).toBe(true);
    expect(slimVenueToPin({ ...slim, name: "The Crosse Keys" }).accessibility).toMatchObject({ stepFree: false, accessibleToilet: true });
  });

  it.each(["venue-mcr-abc123", "venue-xyz-abc123", "venue-uk-n123"])("does not give London access facts to %s", (id) => {
    expect(slimVenueToPin({ ...slim, id, name: "The Ice Wharf - JD Wetherspoon", borough: "Camden" }).accessibility).toBeUndefined();
  });

  it("maps the pin-critical fields straight through", () => {
    const pin = slimVenueToPin(slim);
    expect(pin.id).toBe("venue-abc123");
    expect(pin.name).toBe("The Prospect of Whitby");
    expect(pin.latitude).toBe(51.509);
    expect(pin.longitude).toBe(-0.0498);
    expect(pin.cheapestPrice).toBe(5.2);
    expect(pin.primaryBorough).toBe("Tower Hamlets");
    expect(pin.locality).toBe("Wapping");
  });

  it("recovers slim addresses from the compact search contract", () => {
    const pin = slimVenueToPin({
      ...slim,
      name: "The Sir Christopher Hatton",
      borough: "Camden",
      locality: "Hatton Garden",
      filterHints: {
        ...slim.filterHints!,
        searchText:
          "the sir christopher hatton 4 leather lane, holborn, ec1n 7ra, london camden",
      },
    });

    expect(pin.address).toBe("4 leather lane, holborn, ec1n 7ra, london");
  });

  it("preserves a null cheapestPrice (bucketed as no-price by the canvas)", () => {
    const pin = slimVenueToPin({ ...slim, cheapestPrice: null });
    expect(pin.cheapestPrice).toBeNull();
  });

  it("lights hasStory from slim filterHints so heritage rings paint before detail", () => {
    expect(slimVenueToPin(slim).hasStory).toBe(true);
    expect(
      slimVenueToPin({
        ...slim,
        filterHints: {
          ...slim.filterHints!,
          curation: { nearWater: false, hasStory: false },
        },
      }).hasStory,
    ).toBe(false);
  });

  it("degrades prices to [] so priceForBeer returns null (favorite-pint dims until hydration)", () => {
    expect(slimVenueToPin(slim).prices).toEqual([]);
  });

  it("carries inert, non-throwing defaults for every full-Venue field the pipeline reads", () => {
    const pin = slimVenueToPin(slim);
    // filterVenues reads amenities.* / curation.* / address / visibleBoroughs —
    // all present and safe so a stray pre-hydration read never throws.
    expect(pin.amenities.beerGarden).toBe(false);
    expect(pin.amenities.nonAlcoholic).toBe(false);
    expect(pin.curation).toEqual({});
    expect(pin.visibleBoroughs).toEqual(["Tower Hamlets"]);
    expect(pin.latestContributorPrice).toBeNull();
    expect(pin.averagePrice).toBeNull();
  });

  it("carries slim filter hints through to the venue-shaped pin", () => {
    expect(slimVenueToPin(slim).filterHints).toEqual(slim.filterHints);
  });

  it("carries optional venue kind and type-relative price band to the map pin", () => {
    const pin = slimVenueToPin({
      ...slim,
      kind: "bar",
      priceBand: 1,
      anchorLabel: "House cocktail",
      anchorObservedAt: "2026-07-26",
      anchorSourceUrl: "https://example.com/menu",
    });
    expect(pin.kind).toBe("bar");
    expect(pin.priceBand).toBe(1);
    expect(pin.anchorLabel).toBe("House cocktail");
    expect(pin.anchorObservedAt).toBe("2026-07-26");
    expect(pin.anchorSourceUrl).toBe("https://example.com/menu");
  });

  it("keeps legacy slim rows backward-compatible as pubs", () => {
    const pin = slimVenueToPin(slim);
    expect(pin.kind).toBeUndefined();
    expect(pin.priceBand).toBeUndefined();
  });

  it("produces an empty visibleBoroughs when borough is blank", () => {
    expect(slimVenueToPin({ ...slim, borough: "" }).visibleBoroughs).toEqual([]);
  });

  it("returns a value the pin-render path can key on by id", () => {
    const pin = slimVenueToPin(slim);
    expect(typeof pin.id).toBe("string");
    expect(pin.id.length).toBeGreaterThan(0);
  });
});

describe("slimVenuesToPins", () => {
  it("excludes confirmed closed identities from incoming map pins without changing the rows", () => {
    const rows = [
      slim,
      ...["venue-1fabngq", "venue-osm-w65382138", "venue-uk-w65382138"].map((id) => ({
        ...slim, id, name: "The Kentish Drovers", cheapestPrice: 2.43,
      })),
      { ...slim, id: "venue-def456", name: "Second" },
    ];
    expect(slimVenuesToPins(rows).map((pin) => pin.id)).toEqual(["venue-abc123", "venue-def456"]);
    expect(rows).toHaveLength(5);
    expect(rows[1]?.cheapestPrice).toBe(2.43);
  });

  it("maps a list preserving order and length", () => {
    const pins = slimVenuesToPins([slim, { ...slim, id: "venue-def456", name: "Second" }]);
    expect(pins.map((p) => p.id)).toEqual(["venue-abc123", "venue-def456"]);
  });

  it("returns [] for an empty input", () => {
    expect(slimVenuesToPins([])).toEqual([]);
  });
});

describe("pinsToSlimVenues", () => {
  it("keeps canonical pint evidence through a serialised resume round trip", () => {
    const pin = slimVenueToPin({ ...slim, fairPint: [530, "https://example.com/menu", "2026-11-16"] });
    const snapshot: SlimVenue[] = JSON.parse(JSON.stringify(pinsToSlimVenues([pin])));
    const restored = slimVenuesToPins(snapshot)[0]!;
    expect(restored.fairPint).toEqual([530, "https://example.com/menu", "2026-11-16"]);
    expect(fairPence(restored, Date.parse("2026-11-17"))).toBe(530);
  });

  it("keeps the published price's read day in the resume snapshot, so a restored pin is not aged", () => {
    const pin = slimVenueToPin({ ...slim, priceObservedAt: "2026-10-01" });
    const compacted = pinsToSlimVenues([pin])[0]!;
    expect(compacted.priceObservedAt).toBe("2026-10-01");
    expect(slimVenueToPin(compacted).priceObservedAt).toBe("2026-10-01");
  });
});

describe("an expired listed price in a slim payload", () => {
  const today = Date.parse("2026-11-23T12:00:00.000Z");
  const estimate = { priceGbp: 5.5, basis: "postcode_area:LL", sampleSize: 26, computedAt: "2026-11-23T07:45:21.844Z" };
  const listedRow = (id: string, cheapestPrice: number, priceObservedAt: string) => ({
    id, name: "The Queen Victoria", lat: 53.3273, lng: -3.8322, cheapestPrice, cheapestPint: "Guinness", measure: "pint",
    priceSource: "Guinndex", priceObservedAt, estimate, borough: "Llandudno",
  });

  it("reaches every reader unpriced, keeps the estimate, and keeps the old figure with its date", () => {
    const [april, november] = rowsFromSlimPayload(
      { revision: "r1", rows: [listedRow("venue-lla-old", 5.85, "2026-04-11"), listedRow("venue-lla-new", 5.2, "2026-11-01")] },
      today,
    ) as Record<string, unknown>[];
    expect(april).toMatchObject({ cheapestPrice: null, estimate, oldListedPrice: { priceGbp: 5.85, observedAt: "2026-04-11", publisher: "Guinndex" } });
    for (const field of ["priceSource", "priceObservedAt", "cheapestPint", "measure"]) expect(april).not.toHaveProperty(field);
    expect(november).toMatchObject({ cheapestPrice: 5.2, priceObservedAt: "2026-11-01" });
    expect(november).not.toHaveProperty("estimate");
    expect(november).not.toHaveProperty("oldListedPrice");

    const pin = slimVenueToPin(april as unknown as SlimVenue);
    expect(pin.cheapestPrice).toBeNull();
    expect(pin.oldListedPrice).toEqual({ priceGbp: 5.85, observedAt: "2026-04-11", publisher: "Guinndex" });
    expect(pinsToSlimVenues([pin])[0]?.oldListedPrice).toEqual(pin.oldListedPrice);

    const detail = { ...pin, cheapestPrice: 5.85, priceSource: "Guinndex" };
    const [opened] = mergeLazyDetailPins([pin], new Map([[pin.id, detail]]));
    expect(opened).toMatchObject({ cheapestPrice: null, oldListedPrice: pin.oldListedPrice });
  });
});
