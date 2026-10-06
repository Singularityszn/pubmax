import { describe, expect, it } from "vitest";
import { venueBases, parseTaskVenues, dedupeVenues, allowedEvidenceUrl, validateDiscoveryPack, mergeCityVenueSources, assembleCityDiscoveries, gateVenueEvidence, postcodeDistricts, unseenNames } from "../scripts/lib/parallelVenueDiscovery.mjs";
import { parseArgs, taskRequest } from "../scripts/discover_parallel_venues.mjs";
import { buildCitySlim } from "../scripts/build_city_slim_index.mjs";
import { defined } from "@/__tests__/helpers/defined";

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
  it("refuses a source outside the static fence without asking the network", async () => {
    const url = "http://127.0.0.1/evidence";
    const row = { ...venue, kind: "bar" as const, postcode: "B1 1AA", locality: city.displayName, sourceUrls: [url], observedAt: "2026-10-04T10:00:00Z", lat: 52.48, lng: -1.90, coordinatePrecision: "postcode-centroid" as const,
      evidence: [{ url, excerpt: defined(venue.evidence[0]).excerpt }] };
    const gated = await gateVenueEvidence([row], city, async () => { throw new Error("Must not call the network"); });
    expect(gated.venues).toEqual([]);
    expect(defined(gated.rejected[0]).sources).toEqual([{ url, outcome: "refused", reason: "outside-source-fence" }]);
  });
  it("dedupes adjacent-postcode centroids before the exact-coordinate postcode guard", () => {
    const row = { name: "Royal Standard", address: "Oxford OX3 9AA", lat: 51.759856, lng: -1.212887, coordinatePrecision: "postcode-centroid" };
    const existing = { name: "The Royal Standard", address: "Oxford OX3 9AJ", lat: 51.7592403, lng: -1.213449 };
    expect(dedupeVenues([row], [existing]).accepted).toEqual([]);
    expect(dedupeVenues([{ ...row, coordinatePrecision: "source-coordinate" }], [existing]).accepted).toHaveLength(1);
  });
  it("does not merge venue-type variants with different numbered addresses or no address evidence", () => {
    const row = { name: "Black Lion Hotel", address: "65 Chapel Street, Salford M3 5BZ", lat: 53.48461, lng: -2.249663, coordinatePrecision: "postcode-centroid" };
    const other = { name: "The Black Lion Pub", address: "200 Chapel Street, Salford M3 5BZ", lat: 53.48761, lng: -2.249663 };
    expect(dedupeVenues([row], [other]).accepted).toEqual([row]);
    expect(dedupeVenues([row], [{ ...other, lat: row.lat }]).accepted).toEqual([row]);
    expect(dedupeVenues([row], [{ ...other, address: "Salford", lat: row.lat }]).accepted).toEqual([row]);
  });
  it("keeps only independently sufficient permitted excerpts without changing observation dates", async () => {
    const url = "https://camra.org.uk/pubs/copper-rooms";
    const row = { ...venue, kind: "bar" as const, postcode: "B1 1AA", locality: city.displayName, sourceUrls: [venue.website, url], observedAt: "2026-10-04T10:00:00Z", lat: 52.48, lng: -1.90, coordinatePrecision: "postcode-centroid" as const,
      evidence: [...venue.evidence, { url, excerpt: defined(venue.evidence[0]).excerpt }] };
    const gated = await gateVenueEvidence([row], city, async (source) => ({ outcome: source === url ? "allowed" : "refused" }));
    expect(gated.venues).toEqual([{ ...row, sourceUrls: [url], evidence: [{ url, excerpt: defined(venue.evidence[0]).excerpt }] }]);
    expect(gated.rejected).toEqual([]);
    const split = { ...row, evidence: [{ url: venue.website, excerpt: defined(venue.evidence[0]).excerpt }, { url, excerpt: "Copper Rooms cocktail bar." }] };
    expect((await gateVenueEvidence([split], city, async (source) => ({ outcome: source === url ? "allowed" : "refused" }))).venues).toEqual([]);
  });
  it("dedupes Black Lion Hotel against its mapped venue-type name variant", () => {
    const row = {"name": "Black Lion Hotel", "address": "65 Chapel Street, Salford M3 5BZ", "lat": 53.48461, "lng": -2.249663, "coordinatePrecision": "postcode-centroid"};
    const existing = {"name": "The Black Lion Pub", "address": "65, Chapel Street, Salford, M3 5BZ", "lat": 53.4846729, "lng": -2.249412, "osmId": "node/3659125466"};
    expect(dedupeVenues([row], [existing]).accepted).toEqual([]);
  });
  it("dedupes Hillfoot Hotel against its mapped venue-type name variant", () => {
    const row = {"name": "Hillfoot Hotel", "address": "Hillfoot Road, Hunts Cross, Liverpool L25 0NB", "lat": 53.360229, "lng": -2.863635, "coordinatePrecision": "postcode-centroid"};
    const existing = {"name": "The Hillfoot Inn", "address": "Hillfoot Road, Liverpool, L25 0NB", "lat": 53.3599325, "lng": -2.8652773, "osmId": "way/1560285044"};
    expect(dedupeVenues([row], [existing]).accepted).toEqual([]);
  });
  it("withdraws evidence from a robots-refused or unreachable source", async () => {
    const row = { ...venue, kind: "bar" as const, postcode: "B1 1AA", locality: city.displayName, sourceUrls: [venue.website], observedAt: "2026-10-04T10:00:00Z", lat: 52.48, lng: -1.90, coordinatePrecision: "postcode-centroid" as const };
    for (const outcome of ["refused", "skipped"]) {
      const gated = await gateVenueEvidence([row], city, async () => ({ outcome, reason: "robots-unreadable" }));
      expect(gated.venues).toEqual([]);
      expect(gated.rejected).toMatchObject([{ name: "Copper Rooms", reason: "source-permission: insufficient permitted evidence" }]);
    }
  });
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
    defined(raw.output.basis[0]).field = "venues.1";
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates).toEqual([]);
  });
  it("requires restaurant alcohol evidence", () => {
    const raw = result({ ...venue, kind: "restaurant" });
    const quote = "Copper Rooms restaurant, 12 Test Street, Birmingham, B1 1AA. Wine sauce and coffee.";
    defined(raw.output.content.venues[0]).evidence = [{ url: venue.website, excerpt: quote }];
    defined(defined(raw.output.basis[0]).citations[0]).excerpts = [quote];
    expect(defined(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").rejected[0]).reason).toBe("missing-drinking-evidence");
  });
  it("keeps source coordinates only when quoted, leaving invented points for geocoding", () => {
    const raw = result({ ...venue, lat: 52.48, lng: -1.90 });
    expect(defined(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates[0]).lat).toBeNull();
  });
  it("dedupes name variants near existing venues and within a discovery batch", () => {
    const existing = [{ name: "The Copper Rooms", lat: 52.48, lng: -1.90 }];
    const nearby = { name: "Copper Rooms", lat: 52.4802, lng: -1.9001 };
    const far = { name: "Copper Rooms", lat: 52.51, lng: -1.90 };
    const different = { name: "Silver Rooms", lat: 52.48, lng: -1.90 };
    expect(dedupeVenues([nearby, far, different, { ...different }], existing).accepted).toEqual([far, different]);
  });
  it.each([
    ["Kemp Street, Middleton M24 4AA", [53.549124, -2.204766], "Middleton Archer", "Kemp Street, M24 4UA", [53.5482778, -2.203582], "Middleton Archer"],
    ["77 Kirkway, Middleton M24 1EP", [53.54189, -2.193338], "Lancashire Fold", "77, Kirkway, Manchester, M24 1FL", [53.5435209, -2.1928526], "Lancashire Fold"],
    ["119 Town Lane, Denton M34 2DF", [53.449893, -2.11816], "Jolly Hatters", "Town Lane, M34 2DH", [53.4494406, -2.1198538], "The Jolly Hatters"],
    ["60-62 High Street, City Centre, Manchester M4 1EA", [53.483842, -2.238327], "High Street Tavern", "5, Nicholas Croft, Manchester, M4 1EY", [53.4844707, -2.2384421], "High Street Tavern"],
    ["Springwood Avenue, Allerton, Liverpool L25 7UN", [53.361897, -2.871587], "Allerton Hall", "Clarke's Gardens, Liverpool, L25 7UN", [53.3633959, -2.8792324], "Allerton Hall"],
    ["98 Bewley Drive, Kirkby, Liverpool L32 6QL", [53.471722, -2.881459], "Kingfisher", "98, Bewley Drive, Liverpool, L32 6QJ", [53.4714449, -2.8828254], "Kingfisher"],
    ["78 London Road, Headington, Oxford OX3 9AA", [51.759856, -1.212887], "Royal Standard", "78, London Road, OX3 9AJ", [51.7592403, -1.213449], "The Royal Standard"],
    ["1 Lime Walk, Headington, Oxford OX3 7RD", [51.759531, -1.213994], "Britannia", "74, London Road, OX3 7AA", [51.7590452, -1.2139214], "The Britannia Inn"],
    ["21-23 Hollywood Road, Brislington, Bristol BS4 4LD", [51.437534, -2.549317], "Pilgrim Inn", "21, Hollywood Road, Bristol, BS4 4LE", [51.4352354, -2.5482971], "The Pilgrim Inn"],
  ])("matches the discovery at %s to the OSM pub already on the map", (address, [lat, lng], name, osmAddress, [osmLat, osmLng], osmName) => {
    const discovery = { name, address, lat: defined(lat), lng: defined(lng), coordinatePrecision: "postcode-centroid" };
    const osm = { name: osmName, address: osmAddress, lat: defined(osmLat), lng: defined(osmLng), osmId: "node/1" };
    expect(dedupeVenues([discovery], [osm])).toMatchObject({ accepted: [], duplicates: [{ name, matchedName: osmName, matchedId: "node/1" }] });
  });
  it.each([
    ["Nags Head", "41 Church Street, Eccles M30 0BJ", 53.483609, -2.335464, "Nag's Head", "41, Church Street, Manchester, M30 0BJ", 53.4836028, -2.3353344],
    ["Foghertys", "1 Blenheim Rd, Wavertree, Liverpool L18 1EH", 53.389273, -2.91897, "Fogherty's", "Liverpool", 53.3892964, -2.9188591],
    ["The Butcher's Arms", "Wilberforce Street, Headington, Oxford, Oxfordshire OX3 7AN", 51.755851, -1.21103, "The Butchers Arms", "5, Wilberforce Street, Oxford, OX3 7AN", 51.7560089, -1.2111385],
    ["Cricketer's Arms", "102 Temple Cowley Road, Temple Cowley, Oxford OX4 2EZ", 51.736688, -1.211928, "The Cricketers Arms", "Temple Road, Oxford, OX4 2EZ", 51.7357497, -1.2122323],
    ["McDwyers", "79 Warwick Road, Sparkhill, Birmingham, B11 4RD", 52.456138, -1.863885, "McDwyer's", null, 52.4562632, -1.8647139],
    ["Saracens Head", "42 Broad Street, Bath BA1 5LP", 51.384074, -2.360098, "Saracen's Head Tavern", "42, Broad Street, Bath, BA1 5LP", 51.3838525, -2.3598897],
  ])("withdraws %s when apostrophe differences hide an existing map venue", (name, address, lat, lng, osmName, osmAddress, osmLat, osmLng) => {
    const discovery = { name, address, lat, lng, coordinatePrecision: "postcode-centroid" };
    const osm = { name: osmName, address: osmAddress ?? undefined, lat: osmLat, lng: osmLng, osmId: "node/1" };
    expect(dedupeVenues([discovery], [osm])).toMatchObject({ accepted: [], duplicates: [{ name, matchedName: osmName, matchedId: "node/1" }] });
  });
  it.each(["Copper's-Rooms", "Copper’s Rooms", "Copper‘s Rooms", "Copper`s Rooms"])("ignores apostrophe and punctuation variants in %s", (name) => {
    const existing = [{ name: "Coppers Rooms", lat: 52.48, lng: -1.90 }];
    const discovery = { name, lat: 52.48, lng: -1.90 };
    expect(dedupeVenues([discovery], existing).accepted).toEqual([]);
  });
  it("keeps separate branches after removing apostrophe differences", () => {
    const existing = [{ name: "Copper's Rooms", address: "12 Test Street, B1 1AA", lat: 52.48, lng: -1.90 }];
    const branch = { name: "Coppers Rooms", address: "212 Test Street, Birmingham B1 4DD", lat: 52.483, lng: -1.90, coordinatePrecision: "postcode-centroid" };
    expect(dedupeVenues([branch], existing).accepted).toEqual([branch]);
  });
  it("keeps unshown food, work and drink rows in research context but never lets them withdraw a discovery: the real Velopark Cafe pair", () => {
    const velopark = { name: "Velopark Cafe", address: "National Cycling Centre, Stuart Street, Clayton M11 4DQ", lat: 53.486398, lng: -2.196838, coordinatePrecision: "postcode-centroid" };
    const foodRow = { osmId: "node/5940361450", name: "Velopark Cafe", amenity: "cafe", kind: "cafe", address: "Stuart Street, Manchester, M11 4BZ", lat: 53.4851234, lng: -2.1907685 };
    const workRow = { osmId: "node/77", name: "Velopark Cafe", amenity: "coworking_space", kind: "coworking", address: "Stuart Street, Manchester, M11 4BZ", lat: 53.4851234, lng: -2.1907685 };
    const empty = { ukPubs: [], ukDrink: [], ukFood: [], ukWork: [], cityPubs: [], london: [] };
    for (const packs of [{ ...empty, ukFood: [foodRow] }, { ...empty, ukWork: [workRow] }, { ...empty, ukDrink: [{ ...foodRow, kind: "restaurant" }, { ...foodRow, kind: "other" }, { ...foodRow, kind: "hotel_lounge" }] }]) {
      const { known, shipped } = venueBases(packs);
      expect(known.length).toBeGreaterThan(0);
      expect(shipped).toEqual([]);
      expect(dedupeVenues([velopark], shipped).accepted).toEqual([velopark]);
      expect(dedupeVenues([velopark], known).accepted).toEqual([]);
    }
  });

  it("lets every venue a map ships withdraw a discovery: national pubs, drink-pack bars, city pubs and London", () => {
    const velopark = { name: "Velopark Cafe", address: "National Cycling Centre, Stuart Street, Clayton M11 4DQ", lat: 53.486398, lng: -2.196838, coordinatePrecision: "postcode-centroid" };
    const osmRow = { osmId: "node/5940361450", name: "Velopark Cafe", address: "Stuart Street, Manchester, M11 4BZ", lat: 53.4851234, lng: -2.1907685 };
    const empty = { ukPubs: [], ukDrink: [], ukFood: [], ukWork: [], cityPubs: [], london: [] };
    for (const packs of [{ ...empty, ukPubs: [osmRow] }, { ...empty, ukDrink: [{ ...osmRow, kind: "bar" }] }, { ...empty, cityPubs: [osmRow] }]) {
      expect(dedupeVenues([velopark], venueBases(packs).shipped)).toMatchObject({ accepted: [], duplicates: [{ name: "Velopark Cafe", matchedId: "node/5940361450" }] });
    }
    const london = venueBases({ ...empty, london: [{ pub_name: "The Copper Rooms", latitude: 52.48, longitude: -1.90, address: "12 Test Street, B1 1AA" }] }).shipped;
    expect(dedupeVenues([{ name: "Copper Rooms", address: "12 Test Street, Birmingham B1 1AA", lat: 52.4805, lng: -1.90, coordinatePrecision: "postcode-centroid" }], london).accepted).toEqual([]);
  });

  it("keeps same-name branches with different house numbers on one street apart within a centroid's spread", () => {
    const existing = [{ name: "Copper Rooms", address: "12, Test Street, B1 1AA", lat: 52.48, lng: -1.90, osmId: "node/1" }];
    const branch = { name: "Copper Rooms", address: "212 Test Street, Birmingham B1 4DD", lat: 52.483, lng: -1.90, coordinatePrecision: "postcode-centroid" };
    const unnumbered = { name: "Copper Rooms", address: "Test Street, Birmingham B1 4DD", lat: 52.483, lng: -1.90, coordinatePrecision: "postcode-centroid" };
    expect(dedupeVenues([branch], existing).accepted).toEqual([branch]);
    expect(dedupeVenues([unnumbered], existing).accepted).toEqual([]);
  });
  it("keeps nearby branches of one name whose street addresses differ", () => {
    const existing = [{ name: "Copper Rooms", lat: 52.48, lng: -1.90, address: "12 Test Street, B1 1AA" }];
    const otherStreet = { name: "Copper Rooms", lat: 52.4815, lng: -1.90, address: "3 Other Road, Birmingham B1 2BB", coordinatePrecision: "postcode-centroid" };
    const otherNumber = { name: "Copper Rooms", lat: 52.4788, lng: -1.90, address: "140 Test Street, Birmingham B1 3CC", coordinatePrecision: "postcode-centroid" };
    expect(dedupeVenues([otherStreet, otherNumber], existing).accepted).toEqual([otherStreet, otherNumber]);
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
  it.each(["--matches=Infinity", "--concurrency=0", "--processor=constructor", "--budget=10", "--cities=london", "--cities=sheffield"]) ("refuses invalid CLI input %s before spending", (arg) => {
    expect(() => parseArgs([arg])).toThrow();
  });
  it("does not retain a fabricated street address merely because postcode is cited", () => {
    const raw = result({ ...venue, address: "99 Invented Street, Birmingham, B1 1AA" });
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates).toEqual([]);
  });
  it.each([
    "Upstairs, 99 Invented Street, Birmingham, B1 1AA",
    "Upstairs, 99 Invented Street, Birmingham B1 1AA",
    "99 Invented Street Birmingham B1 1AA",
  ])("does not retain a fabricated street behind a quoted qualifier: %s", (address) => {
    const quote = "Copper Rooms cocktail bar, Upstairs, Birmingham, B1 1AA.";
    const raw = result({ ...venue, address, evidence: [{ url: venue.website, excerpt: quote }] });
    defined(defined(raw.output.basis[0]).citations[0]).excerpts = [quote];
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").rejected).toEqual([{ name: "Copper Rooms", reason: "citation-does-not-bind-name-and-address" }]);
  });
  it("keeps a qualified address when every part of it is quoted", () => {
    const quote = "Copper Rooms cocktail bar, Upstairs, 12 Test Street, Birmingham B1 1AA.";
    const raw = result({ ...venue, address: "Upstairs, 12 Test Street, Birmingham B1 1AA", evidence: [{ url: venue.website, excerpt: quote }] });
    defined(defined(raw.output.basis[0]).citations[0]).excerpts = [quote];
    expect(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates).toMatchObject([{ address: "Upstairs, 12 Test Street, Birmingham B1 1AA" }]);
  });
  it("refuses a persisted row whose street its quotes never state", () => {
    const row = { ...venue, address: "Upstairs, 99 Invented Street, Birmingham B1 1AA", postcode: "B1 1AA", locality: city.displayName, sourceUrls: [venue.website], observedAt: "2026-10-04T10:00:00Z", lat: 52.48, lng: -1.90, coordinatePrecision: "postcode-centroid",
      evidence: [{ url: venue.website, excerpt: "Copper Rooms cocktail bar, Upstairs, Birmingham, B1 1AA." }] };
    expect(() => validateDiscoveryPack({ city: city.id, venues: [row] }, city)).toThrow("Invalid Parallel venue evidence");
  });
  it("fits every Task request to the input limit in one place and reports partial exclusions", () => {
    const known = Array.from({ length: 2000 }, (_, index) => ({ name: `A venue with a long name ${index}`, postcode: "B1 1AA" }));
    const body = taskRequest({ objective: "Find bars", context: { postcodeDistrict: "B1" }, known, processor: "pro" });
    expect(JSON.stringify({ input: body.input, task_spec: body.task_spec }).length).toBeLessThanOrEqual(24000);
    expect(body.input.knownVenueNames.length).toBeGreaterThan(0);
    expect(body.input.contextIsPartial).toBe(true);
    expect(body.input.totalKnownVenues).toBe(2000);
    const small = taskRequest({ objective: "Find bars", context: {}, known: known.slice(0, 3), processor: "pro" });
    expect(small.input).toMatchObject({ knownVenueNames: known.slice(0, 3).map((row) => `${row.name} (B1 1AA)`), contextIsPartial: false });
  });
  it("keeps paging only while a page names a venue not already known or returned", () => {
    const known = [{ name: "The Copper Rooms" }];
    expect(unseenNames([{ name: "Copper Rooms" }, { name: "Silver Rooms" }, { name: "silver rooms" }, null], known)).toEqual(["Silver Rooms"]);
    expect(unseenNames([{ name: "Copper Rooms" }], known)).toEqual([]);
    expect(unseenNames([], known)).toEqual([]);
  });
  it("splits a city into the postcode districts its known venues sit in", () => {
    const rows = [
      { lat: 52.48, lng: -1.90, postcode: "B1 1AA" }, { lat: 52.48, lng: -1.90, address: "1 Road, B12 9ZZ" },
      { lat: 52.48, lng: -1.90, postcode: "B2 4QA" }, { lat: 51.5, lng: -0.1, postcode: "EC1A 1BB" }, { lat: 52.48, lng: -1.90, postcode: null },
    ];
    expect(postcodeDistricts(rows, city)).toEqual(["B1", "B2", "B12"]);
  });
  it("withdraws a stored discovery an existing venue now matches, naming that venue", () => {
    const observation = { ...venue, address: "78 London Road, Headington, Oxford OX3 9AA", postcode: "OX3 9AA", locality: "Oxford", sourceUrls: [venue.website], observedAt: "2026-10-04T10:00:00Z", lat: 51.759856, lng: -1.212887, coordinatePrecision: "postcode-centroid", provider: "parallel", id: "venue-oxf-royal",
      name: "Royal Standard", evidence: [{ url: venue.website, excerpt: "Royal Standard pub, 78 London Road, Headington, Oxford OX3 9AA." }] };
    const oxford = { id: "oxford", displayName: "Oxford", bbox: [51.72, -1.3, 51.8, -1.2] as [number, number, number, number] };
    const osm = { name: "The Royal Standard", address: "78, London Road, OX3 9AJ", lat: 51.7592403, lng: -1.213449, osmId: "node/7" };
    const assembled = assembleCityDiscoveries({ found: [], previous: [observation], existing: [osm], city: oxford });
    expect(assembled.venues).toEqual([]);
    expect(assembled.withdrawn).toEqual([{ name: "Royal Standard", id: "venue-oxf-royal", reason: "duplicate of an existing venue", matchedName: "The Royal Standard", matchedId: "node/7" }]);
  });
  it("reports a replayed city's own earlier discoveries as retained, not as duplicates of themselves", () => {
    const observation = { ...venue, postcode: "B1 1AA", locality: city.displayName, sourceUrls: [venue.website], observedAt: "2026-10-04T10:00:00Z", lat: 52.48, lng: -1.90, coordinatePrecision: "postcode-centroid" };
    const row: typeof observation & { id?: string } = { ...observation, id: "venue-bhm-copper" };
    const fresh: typeof row = { ...observation, name: "Brass Rooms", address: "14 Test Street, Birmingham, B1 1AA", lat: 52.47, evidence: [{ url: venue.website, excerpt: "Brass Rooms cocktail bar, 14 Test Street, Birmingham, B1 1AA." }] };
    const osm = { name: "The Copper Rooms", address: "200 Far Road, B5 7ZZ", lat: 52.45, lng: -1.90, osmId: "node/1" };
    const assembled = assembleCityDiscoveries({ found: [observation, fresh, { ...fresh }], previous: [row], existing: [osm], city });
    expect(assembled.retained).toEqual([{ name: "Copper Rooms", id: "venue-bhm-copper" }]);
    expect(assembled.duplicates).toEqual([]);
    expect(assembled.accepted).toEqual([fresh]);
    expect(assembled.repeats).toBe(1);
    expect(assembled.venues).toEqual([row, fresh]);
  });
  it("publishes discovered bars and restaurants with their kind and no invented price", () => {
    const config = { ...city, shortPrefix: "bhm", enabled: true };
    const rows = [{ name: "Copper Rooms", lat: 52.48, lng: -1.90, kind: "bar" }, { name: "Silver Rooms", lat: 52.481, lng: -1.91, kind: "restaurant" }];
    const built = buildCitySlim(config, { pubs: rows });
    expect(built.slim.map((row) => [row.kind, row.cheapestPrice])).toEqual([["bar", null], ["restaurant", null]]);
    expect(defined(built.slim[1]).filterHints.amenities.food).toBe(true);
  });
  it("does not accept a decimal prefix as a cited coordinate", () => {
    const quote = "Copper Rooms cocktail bar, 12 Test Street, Birmingham, B1 1AA. Coordinates 52.480123, -1.900123.";
    const raw = result({ ...venue, lat: 52.48, lng: -1.9, evidence: [{ url: venue.website, excerpt: quote }] });
    defined(defined(raw.output.basis[0]).citations[0]).excerpts = [quote];
    expect(defined(parseTaskVenues(raw, city, "2026-10-04T10:00:00Z").candidates[0]).lat).toBeNull();
  });
});
