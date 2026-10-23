import { describe, expect, it } from "vitest";
import { filterMapVenues, mapFiltersSuspendUkBasePubs } from "@/lib/filterMapVenues";
import { initialFilters, type Venue } from "@/lib/venues";
import { mergeLazyDetailPins } from "@/lib/lazyVenueDetail";
import { slimVenueToPin } from "@/lib/slimPins";
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
