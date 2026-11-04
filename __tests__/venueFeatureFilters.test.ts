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
  it("hides the unpriced base layer under Last orders, which has no hours for it", () => {
    expect(mapFiltersSuspendUkBasePubs({ ...initialFilters, lastOrders: true })).toBe(true);
    expect(mapFiltersSuspendUkBasePubs(initialFilters)).toBe(false);
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

describe("sport and dog map choices", () => {
  it("excludes Finery without a sport source tuple before and after details load", () => {
    const slimRows = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")).rows as SlimVenue[];
    const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
    const slim = slimRows.find((row) => row.id === "venue-15898y3");
    if (!slim) throw new Error("Finery missing from committed slim pack");
    const detail = groupVenuePrices(rows.filter((row) => row.pub_name === "Finery"))[0];
    if (!detail) throw new Error("Finery missing from committed price rows");
    expect(detail.id).toBe("venue-15898y3");
    expect(detail.amenities.liveSports).toBe(true);
    expect(slim.filterHints?.liveSportsSource).toBeUndefined();
    const slimPin = slimVenueToPin(slim);
    const hydrated = mergeLazyDetailPins([slimPin], new Map([[detail.id, detail]]));
    const filters = { ...initialFilters, requireLiveSports: true };
    expect(filterMapVenues([slimPin], filters, () => false)).toEqual([]);
    expect(filterMapVenues(hydrated, filters, () => false)).toEqual([]);
    expect(filterMapVenues([detail], filters, () => false)).toEqual([]);
  });
  it("keeps the specified 512 sport matches across whole-pack detail hydration", () => {
    const slimRows = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8")).rows as SlimVenue[];
    const rows = JSON.parse(readFileSync("public/data/pint_prices_app_dataset.json", "utf8")) as VenuePrice[];
    const slimPins = slimRows.map(slimVenueToPin);
    const details = groupVenuePrices(rows);
    const hydrated = mergeLazyDetailPins(slimPins, new Map(details.map((venue) => [venue.id, venue])));
    const filters = { ...initialFilters, requireLiveSports: true };
    const before = filterMapVenues(slimPins, filters, () => false).map((venue) => venue.id).sort();
    const after = filterMapVenues(hydrated, filters, () => false).map((venue) => venue.id).sort();
    expect(before).toHaveLength(512);
    expect(after).toHaveLength(512);
    expect(after).toEqual(before);
  });
  it("excludes unknown sport before details load", () => {
    const unknown = pin("unknown", { amenities: { ...pin("unknown").amenities, liveSports: true } });
    expect(filterMapVenues([unknown], { ...initialFilters, requireLiveSports: true }, () => false)).toEqual([]);
  });
  it("matches stated dog welcome and rejects an outside-only policy", () => {
    const welcome = pin("welcome", { osmFacts: { osmId: "node/1", readOn: "2026-10-05", dog: "yes" } });
    const outside = pin("outside", { osmFacts: { osmId: "node/2", readOn: "2026-10-05", dog: "outside" } });
    expect(filterMapVenues([welcome, outside, pin("unknown")], { ...initialFilters, requireDogFriendly: true }, () => false)).toEqual([welcome]);
  });
});


describe("recorded feature hydration", () => {
  it.each([["requireLiveSports", "liveSports"], ["requireDarts", "darts"], ["requirePool", "pool"]] as const)("keeps %s membership after detail hydration", (filter, amenity) => {
    const hints = { searchText: "", amenities: { food: false, cocktails: false, beerGarden: false, liveSports: false, nonAlcoholic: false, [amenity]: true }, curation: { nearWater: false, hasStory: false }, canonical: false };
    const slim = pin("stated", { filterHints: { ...hints, ...(amenity === "liveSports" ? { liveSportsSource: [true, "OpenStreetMap", "2026-10-05"] as const } : {}) } });
    const detail = pin("stated", { prices: [{} as VenuePrice] });
    const hydrated = mergeLazyDetailPins([slim], new Map([[detail.id, detail]]));
    expect(filterMapVenues([slim, pin("unknown")], { ...initialFilters, [filter]: true }, () => false).map((venue) => venue.id)).toEqual(["stated"]);
    expect(filterMapVenues(hydrated, { ...initialFilters, [filter]: true }, () => false).map((venue) => venue.id)).toEqual(["stated"]);
    expect(mapFiltersSuspendUkBasePubs({ ...initialFilters, [filter]: true })).toBe(true);
  });
  it("joins dog website quotes and OSM sport without changing source dates", () => {
    const venues = [{ id: "venue-a", name: "Anchor", lat: 51.5, lng: -0.1 }];
    const pubs = [{ osmId: "node/1", curatedRef: { source: "curated-london-slim", id: "venue-a" } }];
    const facts = [{ osmId: "node/1", readOn: "2026-10-05", liveSport: "yes", dog: "outside" }];
    const website = [{ venueId: "venue-a", sourceUrl: "https://example.org/pub", readOn: "2026-10-09", dogs: { policy: "welcome", evidence: "Dogs welcome." } }];
    expect(buildVenueFeatureHints(venues, pubs, facts, [], website).get("venue-a")).toEqual({ liveSportsSource: [true, "OpenStreetMap", "2026-10-05"], dogsWelcome: [true, "Pub website", "2026-10-09"] });
    expect(buildVenueFeatureHints(venues, pubs, facts, [], [{ ...website[0], dogs: { policy: "welcome", evidence: "" } }]).get("venue-a")?.dogsWelcome?.[0]).toBe(false);
  });
});

it("keeps explicit sport and dog absences authoritative after hydration", () => {
  const base = pin("conflict");
  const filterHints = { searchText: "", amenities: { food: false, cocktails: false, beerGarden: false, liveSports: true, nonAlcoholic: false }, curation: { nearWater: false, hasStory: false }, canonical: false, liveSportsSource: [false, "OpenStreetMap", "2026-10-05"] as const, dogsWelcome: [false, "Pub website", "2026-10-09"] as const };
  const detail = { ...base, amenities: { ...base.amenities, liveSports: true }, osmFacts: { osmId: "node/1", readOn: "2026-10-05", dog: "yes" } };
  const hydrated = mergeLazyDetailPins([{ ...base, filterHints }], new Map([[base.id, detail]]));
  for (const filter of ["requireLiveSports", "requireDogFriendly"] as const) {
    expect(filterMapVenues(hydrated, { ...initialFilters, [filter]: true }, () => false)).toEqual([]);
  }
});

describe("the Last orders caption", () => {
  it("says the hours could not be read, only when they could not", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: VenueFeatureFilters } = await import("@/components/map/VenueFeatureFilters");
    const on = { ...initialFilters, lastOrders: true };
    const render = (lastOrdersFailed: boolean, resultCount: number | null) =>
      renderToStaticMarkup(createElement(VenueFeatureFilters, { filters: on, onChange: () => {}, resultCount, lastOrdersFailed }));
    expect(render(true, 0)).toContain("We could not read pub hours, so no pub is shown as open.");
    expect(render(false, 12)).not.toContain("We could not read pub hours");
    expect(render(false, null)).toContain("Loading matching places");
  });
});
