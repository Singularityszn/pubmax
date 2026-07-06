import { describe, it, expect } from "vitest";

import { slimVenueToPin, slimVenuesToPins } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";

const slim: SlimVenue = {
  id: "venue-abc123",
  name: "The Prospect of Whitby",
  lat: 51.509,
  lng: -0.0498,
  cheapestPrice: 5.2,
  borough: "Tower Hamlets",
};

describe("slimVenueToPin", () => {
  it("maps the six pin-critical fields straight through", () => {
    const pin = slimVenueToPin(slim);
    expect(pin.id).toBe("venue-abc123");
    expect(pin.name).toBe("The Prospect of Whitby");
    expect(pin.latitude).toBe(51.509);
    expect(pin.longitude).toBe(-0.0498);
    expect(pin.cheapestPrice).toBe(5.2);
    expect(pin.primaryBorough).toBe("Tower Hamlets");
  });

  it("preserves a null cheapestPrice (bucketed as no-price by the canvas)", () => {
    const pin = slimVenueToPin({ ...slim, cheapestPrice: null });
    expect(pin.cheapestPrice).toBeNull();
  });

  it("degrades hasStory to false until hydration (no brass ring)", () => {
    expect(slimVenueToPin(slim).hasStory).toBe(false);
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
  it("maps a list preserving order and length", () => {
    const pins = slimVenuesToPins([slim, { ...slim, id: "venue-def456", name: "Second" }]);
    expect(pins.map((p) => p.id)).toEqual(["venue-abc123", "venue-def456"]);
  });

  it("returns [] for an empty input", () => {
    expect(slimVenuesToPins([])).toEqual([]);
  });
});
