import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Amenity } from "@/components/map/venueInspectorBits";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterMapVenues, mapFiltersSuspendUkBasePubs } from "@/lib/filterMapVenues";
import { groupVenuePrices, initialFilters, venueAmenityStatus, type Venue, type VenuePrice, type VenueFeatureObservation } from "@/lib/venues";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import { slimVenueToPin } from "@/lib/slimPins";
import type { SlimVenue } from "@/lib/venuesSlim";
import { buildVenueFeatureHints } from "@/scripts/lib/venueFeatureHints.mjs";

const pin = (id: string, extras: Partial<Venue> = {}) => ({ ...slimVenueToPin({
  id, name: id, lat: 51.5, lng: -0.1, cheapestPrice: null, borough: "London",
}), ...extras });

describe("sourced venue feature filters", () => {
  it("includes only stated beer gardens before details load", () => {
    const garden = pin("garden", { filterHints: { searchText: "", amenities: { food: false, cocktails: false, beerGarden: true, liveSports: false, nonAlcoholic: false }, curation: { nearWater: false, hasStory: false }, canonical: false } });
    expect(filterMapVenues([garden, pin("unknown")], { ...initialFilters, requireBeerGarden: true }, () => false)).toEqual([garden]);
  });
  it("keeps outdoor seating separate from gardens and rejects unknown evidence", () => {
    const outdoor = pin("outdoor", { filterHints: { searchText: "", amenities: { food: false, cocktails: false, beerGarden: false, liveSports: false, nonAlcoholic: false }, curation: { nearWater: false, hasStory: false }, canonical: false, outdoorSeating: [true, "OpenStreetMap", "2026-10-05"] } });
    const noOutdoor = pin("no-outdoor", { filterHints: { ...outdoor.filterHints as NonNullable<Venue["filterHints"]>, outdoorSeating: [false, "OpenStreetMap", "2026-10-05"] } });
    const future = pin("future", { filterHints: { ...outdoor.filterHints as NonNullable<Venue["filterHints"]>, outdoorSeating: [true, "Google Places", "2999-01-01"] } });
    const filters = { ...initialFilters, requireOutdoorSeating: true };
    expect(filterMapVenues([outdoor, noOutdoor, future, pin("unknown")], filters, () => false)).toEqual([outdoor]);
    expect(filterMapVenues([outdoor], { ...filters, requireBeerGarden: true }, () => false)).toEqual([]);
    expect(mapFiltersSuspendUkBasePubs(filters)).toBe(true);
    expect(mapFiltersSuspendUkBasePubs({ ...initialFilters, requireBeerGarden: true })).toBe(true);
  });
  it("keeps the same outdoor match after venue details load", () => {
    const slim = pin("outdoor", { filterHints: { searchText: "", amenities: { food: false, cocktails: false, beerGarden: false, liveSports: false, nonAlcoholic: false }, curation: { nearWater: false, hasStory: false }, canonical: false, outdoorSeating: [true, "OpenStreetMap", "2026-10-05"] } });
    const merged = mergeLazyDetailPins([slim], new Map([["outdoor", pin("outdoor")]]));
    expect(filterMapVenues(merged, { ...initialFilters, requireOutdoorSeating: true }, () => false)).toHaveLength(1);
  });
  it("keeps the Edinboro Castle garden after its real price rows hydrate", () => {
    const slimRows = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")).rows as SlimVenue[];
    const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
    const slim = slimRows.find((row) => row.id === "venue-1e1zj83");
    if (!slim) throw new Error("Edinboro Castle missing from committed slim pack");
    const detail = groupVenuePrices(rows.filter((row) => row.pub_name === "The Edinboro Castle"))[0];
    if (!detail) throw new Error("Edinboro Castle missing from committed price rows");
    expect(detail.prices.length).toBeGreaterThan(0);
    expect(detail.amenities.beerGarden).toBe(false);
    expect(slim.filterHints?.beerGardenSource).toEqual([true, "OpenStreetMap", "2026-10-05"]);
    const filters = { ...initialFilters, requireBeerGarden: true };
    const slimPin = slimVenueToPin(slim);
    expect(filterMapVenues([slimPin], filters, () => false)).toHaveLength(1);
    const hydrated = mergeLazyDetailPins([slimPin], new Map([[detail.id, detail]]));
    expect(filterMapVenues(hydrated, filters, () => false)).toHaveLength(1);
    const status = venueAmenityStatus(hydrated[0] ?? detail).beerGarden;
    expect(status).toBe("unknown");
    expect(renderToStaticMarkup(createElement(Amenity, { status, label: "Beer garden" }))).toBe("");
  });
  it("rejects negative, undated, future, and unsupported garden source tuples", () => {
    const baseHints = { searchText: "", amenities: { food: false, cocktails: false, beerGarden: true, liveSports: false, nonAlcoholic: false }, curation: { nearWater: false, hasStory: false }, canonical: false };
    const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
    const detail = groupVenuePrices(rows.filter((row) => row.pub_name === "The Edinboro Castle"))[0];
    if (!detail) throw new Error("Edinboro Castle missing from committed price rows");
    const observations: Array<VenueFeatureObservation | undefined> = [
      undefined,
      [false, "OpenStreetMap", "2026-10-05"],
      [true, "OpenStreetMap", "not-a-date"],
      [true, "OpenStreetMap", "2999-01-01"],
      [true, "Google Places", "2026-10-05"],
    ];
    for (const beerGardenSource of observations) {
      const slim = pin(detail.id, { filterHints: { ...baseHints, beerGardenSource } });
      const hydrated = mergeLazyDetailPins([slim], new Map([[detail.id, detail]]));
      expect(filterMapVenues(hydrated, { ...initialFilters, requireBeerGarden: true }, () => false)).toEqual([]);
    }
  });
  it("keeps a newer explicit garden absence from the pub record", () => {
    const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
    const negativeRows = rows.filter((row) => row.pub_name === "The Edinboro Castle")
      .map((row) => ({ ...row, beer_garden: "no", scraped_at_values: "2026-10-23T12:00:00Z" }));
    const detail = groupVenuePrices(negativeRows)[0];
    if (!detail) throw new Error("Edinboro Castle missing from committed price rows");
    const slim = pin(detail.id, { filterHints: { searchText: "", amenities: { food: false, cocktails: false, beerGarden: true, liveSports: false, nonAlcoholic: false }, curation: { nearWater: false, hasStory: false }, canonical: false, beerGardenSource: [true, "OpenStreetMap", "2026-10-05"] } });
    const hydrated = mergeLazyDetailPins([slim], new Map([[detail.id, detail]]));
    expect(venueAmenityStatus(hydrated[0] ?? detail).beerGarden).toBe("known-false");
    expect(filterMapVenues(hydrated, { ...initialFilters, requireBeerGarden: true }, () => false)).toEqual([]);
  });
  it("keeps the existing unknown-hours behavior", () => {
    const open = pin("open"), closed = pin("closed"), unknown = pin("unknown");
    expect(filterMapVenues([open, closed, unknown], { ...initialFilters, openNow: true }, () => false, (id) => id === "unknown" ? "unknown" : id === "open")).toEqual([open, unknown]);
  });
});

describe("feature hint source join", () => {
  const venues = [{ id: "venue-a", name: "The Anchor", lat: 51.5, lng: -0.1 }];
  const pubs = [{ osmId: "node/1", curatedRef: { source: "curated-london-slim", id: "venue-a" } }];
  it("copies exact OSM facts and their date without inventing a garden", () => {
    const hints = buildVenueFeatureHints(venues, pubs, [{ osmId: "node/1", readOn: "2026-10-05", outdoorSeating: "terrace" }], []);
    expect(hints.get("venue-a")).toEqual({ outdoorSeating: [true, "OpenStreetMap", "2026-10-05"] });
  });
  it("reads verified Places identities through the existing OSM identity parser", () => {
    const records = [{ venueId: "venue-osm-n1", googlePlaceId: "place-one", outdoorSeating: { value: true, source: "google_places", observedAt: "2026-10-06T12:00:00Z" } }];
    expect(buildVenueFeatureHints(venues, pubs, [], records).get("venue-a")?.outdoorSeating).toEqual([true, "Google Places", "2026-10-06T12:00:00Z"]);
    expect(buildVenueFeatureHints(venues, pubs, [], [...records, { ...records[0], googlePlaceId: "place-two" }]).size).toBe(0);
  });
  it("keeps a stated no and rejects ambiguous OSM matches", () => {
    expect(buildVenueFeatureHints(venues, pubs, [{ osmId: "node/1", readOn: "2026-10-05", outdoorSeating: "no" }], []).get("venue-a")?.outdoorSeating?.[0]).toBe(false);
    const duplicate = [...pubs, { ...pubs[0], osmId: "node/2" }];
    expect(buildVenueFeatureHints(venues, duplicate, [{ osmId: "node/1", readOn: "2026-10-05", outdoorSeating: "yes" }, { osmId: "node/2", readOn: "2026-10-05", beerGarden: "yes" }], []).size).toBe(0);
  });
});
