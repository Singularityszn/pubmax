import { describe, expect, it } from "vitest";
import { parseTaskVenues, dedupeVenues, allowedEvidenceUrl, validateDiscoveryPack, mergeCityVenueSources } from "../scripts/lib/parallelVenueDiscovery.mjs";
import { parseArgs, researchExclusions } from "../scripts/discover_parallel_venues.mjs";
import { buildCitySlim } from "../scripts/build_city_slim_index.mjs";

const city = { id: "birmingham", displayName: "Birmingham", bbox: [52.42, -1.98, 52.55, -1.8] as [number, number, number, number] };
const venue = {
  name: "Copper Rooms", kind: "bar", address: "12 Test Street, Birmingham, B1 1AA",
  website: "https://copperrooms.example/", lat: null, lng: null,
  evidence: [{ url: "https://copperrooms.example/", excerpt: "Copper Rooms cocktail bar, 12 Test Street, Birmingham, B1 1AA." }],
};
function result(value: Record<string, unknown> = venue) {
  return { output: { type: "json", content: { venues: [value] }, basis: [{
    field: "venues.0", confidence: "high", citations: [{
      url: "https://copperrooms.example/", excerpts: ["Copper Rooms cocktail bar, 12 Test Street, Birmingham, B1 1AA."],
    }],
  }] } };
}

describe("Parallel venue discovery", () => {
  it("keeps only venue-specific cited identity and address, pending geocoding", () => {
    const parsed = parseTaskVenues(result(), city, "2026-10-04T10:00:00Z");
    expect(parsed.candidates).toMatchObject([{ name: "Copper Rooms", postcode: "B1 1AA", observedAt: "2026-10-04T10:00:00Z" }]);
    expect(parsed.rejected).toEqual([]);
  });
  it("refuses future observations instead of treating generated dates as freshness", () => {
    expect(() => parseTaskVenues(result(), city, "2099-01-01T00:00:00Z")).toThrow("Invalid observation date");
  });
  it.each([
    "https://maps.google.com/place/123", "https://www.google.co.uk/maps/place/123",
    "https://maps.app.goo.gl/123", "https://googleusercontent.com/map",
    "https://localhost/pub", "https://169.254.169.254/pub", "https://nicholsonspubs.co.uk/pub",
  ])("rejects prohibited evidence URL %s", (url) => {
    expect(allowedEvidenceUrl(url)).toBe(false);
  });
  it("rejects invented quotations even when their URL is cited", () => {
    const parsed = parseTaskVenues(result({ ...venue, evidence: [{ url: venue.website, excerpt: "Copper Rooms pub, Birmingham B1 1AA. Invented sentence." }] }), city, "2026-10-04T10:00:00Z");
    expect(parsed.rejected).toEqual([{ name: "Copper Rooms", reason: "missing-venue-specific-citation" }]);
  });
  it("does not borrow citations belonging to another venue", () => {
    const raw = result();
    raw.output.basis[0].field = "venues.1";
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates).toEqual([]);
  });
  it("requires restaurant alcohol evidence", () => {
    const raw = result({ ...venue, kind: "restaurant" });
    const quote = "Copper Rooms restaurant, 12 Test Street, Birmingham, B1 1AA. Wine sauce and coffee.";
    raw.output.content.venues[0].evidence = [{ url: venue.website, excerpt: quote }];
    raw.output.basis[0].citations[0].excerpts = [quote];
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").rejected[0].reason).toBe("missing-drinking-evidence");
  });
  it("keeps source coordinates only when quoted, leaving invented points for geocoding", () => {
    const raw = result({ ...venue, lat: 52.48, lng: -1.90 });
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates[0].lat).toBeNull();
  });
  it("dedupes name variants near existing venues and within a discovery batch", () => {
    const existing = [{ name: "The Copper Rooms", lat: 52.48, lng: -1.90 }];
    const nearby = { name: "Copper Rooms", lat: 52.4802, lng: -1.9001 };
    const far = { name: "Copper Rooms", lat: 52.51, lng: -1.90 };
    const different = { name: "Silver Rooms", lat: 52.48, lng: -1.90 };
    expect(dedupeVenues([nearby, far, different, { ...different }], existing).accepted).toEqual([far, different]);
  });
  it("keeps nearby branches with different postcodes", () => {
    const existing = [{ name: "Copper Rooms", lat: 52.48, lng: -1.90, address: "B1 1AA" }];
    const branch = { name: "Copper Rooms", lat: 52.481, lng: -1.90, address: "B1 2BB", coordinatePrecision: "postcode-centroid" };
    expect(dedupeVenues([branch], existing).accepted).toEqual([branch]);
  });
  it("refuses malformed persisted discovery packs before publishing pins", () => {
    expect(() => validateDiscoveryPack({ city: city.id, venues: [{ ...venue, lat: 52.48, lng: -1.90 }] }, city)).toThrow("Invalid Parallel venue evidence");
  });
  it("merges discoveries without replacing the original OSM observation or duplicate pin", () => {
    const osm = { pubs: [{ name: "The Copper Rooms", lat: 52.48, lng: -1.90 }], fetchedAt: "2025-01-01" };
    const discovery = { city: city.id, venues: [{ ...venue, postcode: "B1 1AA", locality: city.displayName, sourceUrls: [venue.website], observedAt: "2026-10-04T10:00:00Z", lat: 52.4801, lng: -1.90, coordinatePrecision: "postcode-centroid" }] };
    const merged = mergeCityVenueSources(osm, discovery, city);
    expect(merged.pubs).toEqual(osm.pubs);
    expect(merged.fetchedAt).toBe("2025-01-01");
    expect(osm.pubs).toHaveLength(1);
  });
  it.each(["--matches=Infinity", "--city-limit=Infinity", "--processor=constructor", "--budget=10", "--cities=london"]) ("refuses invalid CLI input %s before spending", (arg) => {
    expect(() => parseArgs([arg])).toThrow();
  });
  it("does not retain a fabricated street address merely because postcode is cited", () => {
    const raw = result({ ...venue, address: "99 Invented Street, Birmingham, B1 1AA" });
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates).toEqual([]);
  });
  it("fits research context to API limit while reporting partial exclusions", () => {
    const known = Array.from({ length: 2000 }, (_, index) => ({ name: `A venue with a long name ${index}`, postcode: "B1 1AA" }));
    const context = researchExclusions(known);
    expect(JSON.stringify(context).length).toBeLessThan(15000);
    expect(context.contextIsPartial).toBe(true);
    expect(context.totalKnownVenues).toBe(2000);
  });
  it("publishes discovered bars and restaurants with their kind and no invented price", () => {
    const config = { ...city, shortPrefix: "bhm", enabled: true };
    const rows = [{ name: "Copper Rooms", lat: 52.48, lng: -1.90, kind: "bar" }, { name: "Silver Rooms", lat: 52.481, lng: -1.91, kind: "restaurant" }];
    const built = buildCitySlim(config, { pubs: rows });
    expect(built.slim.map((row) => [row.kind, row.cheapestPrice])).toEqual([["bar", null], ["restaurant", null]]);
    expect(built.slim[1].filterHints.amenities.food).toBe(true);
  });
  it("does not accept a decimal prefix as a cited coordinate", () => {
    const quote = "Copper Rooms cocktail bar, 12 Test Street, Birmingham, B1 1AA. Coordinates 52.480123, -1.900123.";
    const raw = result({ ...venue, lat: 52.48, lng: -1.9, evidence: [{ url: venue.website, excerpt: quote }] });
    raw.output.basis[0].citations[0].excerpts = [quote];
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates[0].lat).toBeNull();
  });
});
