import { describe, expect, it } from "vitest";
import { ownSiteFor, parseTaskVenues, validateDiscoveryPack } from "../scripts/lib/parallelVenueDiscovery.mjs";
import { rankSearchResults, readFailureIsDefinitive, webPageResult } from "../scripts/lib/webVenueDiscovery.mjs";
import { parseArgs } from "../scripts/discover_parallel_venues.mjs";

const manchester = { id: "manchester", displayName: "Manchester", bbox: [53.38, -2.35, 53.55, -2.1] as [number, number, number, number] };
const observedAt = "2026-10-04T10:00:00Z";
const read = (landedUrl: string, text: string, title: string | null = null, district = "M3") =>
  parseTaskVenues(webPageResult({ landedUrl, text, title }, manchester, district), manchester, observedAt, { local: true });

describe("Tavily venue discovery", () => {
  it("reads a venue's own page into one entry quoting its name, street and postcode", () => {
    const text = "Home\n\n**Copper Rooms**\n\n12 Test Street\n\nManchester\n\nM3 2BY\n\nA cocktail bar in the city centre.";
    const parsed = read("https://www.copperrooms.example/contact", text, "Copper Rooms | Cocktail bar");
    expect(parsed.candidates).toMatchObject([{ name: "Copper Rooms", kind: "bar", postcode: "M3 2BY", website: "https://www.copperrooms.example/",
      address: "12 Test Street, Manchester M3 2BY", sourceUrls: ["https://www.copperrooms.example/contact"] }]);
    expect(parsed.candidates[0].evidence[0].excerpt).toContain("Copper Rooms");
    expect(parsed.candidates[0].evidence[0].excerpt).toContain("M3 2BY");
  });

  it("reads each listing entry with its own address, never lends a name to the next entry and skips closed ones", () => {
    const text = [
      "Black Friar", "Pub, in Salford", "2 Changing Beers", "Cask Ale", "0.5 miles from you", "41-43 Blackfriars Road, Salford, M3 7DB",
      "Eagle Inn", "Pub, in Salford", "Cask Ale", "18-19 Collier Street, Salford, M3 7DW",
      "22 Gore Street, Salford, M3 5FP",
      "Salford Social Club", "Club, in Salford", "Cask Ale not available", "33 Blackfriars Road, Salford, M3 7AQ",
      "Kings Arms", "Open", "Pub, in Salford", "Cask Ale", "11 Bloom Street, Salford, M3 6AN",
      "Old Mill", "Closed", "Pub, in Salford", "Cask Ale", "4 Mill Street, Salford, M3 6BB",
    ].join("\n");
    const parsed = read("https://camra.org.uk/pubs/location/salford", text);
    expect(parsed.candidates.map((row) => [row.name, row.address])).toEqual([
      ["Black Friar", "41-43 Blackfriars Road, Salford M3 7DB"],
      ["Eagle Inn", "18-19 Collier Street, Salford M3 7DW"],
      ["Kings Arms", "11 Bloom Street, Salford M3 6AN"],
    ]);
  });

  it("reads names and streets, not list numbers, labels or opening hours", () => {
    const text = "7. The Gin Bar\nWhere: 2-3 Queen Street M3 1HE\n\nSunday until 10am. Restaurant daily 11am to 10pm\nBar to 12.30am. Court Lane, Manchester M3 2AW";
    expect(read("https://www.designmynight.com/manchester/bars", text).candidates.map((row) => [row.name, row.address])).toEqual([["The Gin Bar", "2-3 Queen Street M3 1HE"]]);
  });

  it("adds nothing from an article that is neither a venue's own site nor a listing", () => {
    const text = "Where to watch\n\nThe Royal Oak, 440 Barlow Moor Rd, Chorlton-cum-Hardy, Manchester M21 0BQ. An old-fashioned pub.";
    expect(read("https://footballgroundguide.com/news/where-to-watch", text, "The Royal Oak", "M21").candidates).toEqual([]);
  });

  it("refuses a listing row that pairs one venue's name with another entry's address", () => {
    const row = { name: "Bar A", kind: "bar", address: "2 Low Street, Manchester M3 2BB", website: null, lat: null, lng: null, evidence: [
      { url: "https://camra.org.uk/pubs/manchester", excerpt: "Bar A, 1 High Street, Manchester M3 1AA" },
      { url: "https://camra.org.uk/pubs/manchester", excerpt: "Bar B, 2 Low Street, Manchester M3 2BB" },
    ] };
    const page = "Bar A, 1 High Street, Manchester M3 1AA\nBar B, 2 Low Street, Manchester M3 2BB";
    const result = { output: { type: "json", content: { venues: [row] }, basis: [{ field: "venues.0", confidence: "high", citations: [{ url: row.evidence[0].url, excerpts: [page] }] }] } };
    expect(parseTaskVenues(result, manchester, observedAt, { local: true }).rejected).toEqual([{ name: "Bar A", reason: "citation-does-not-bind-name-and-address" }]);
    expect(parseTaskVenues(result, manchester, observedAt).candidates).toHaveLength(1);
    const stored = { ...row, postcode: "M3 2BB", locality: "Manchester", sourceUrls: [row.evidence[0].url], observedAt, lat: 53.48, lng: -2.25, coordinatePrecision: "postcode-centroid" };
    expect(() => validateDiscoveryPack({ city: "manchester", venues: [{ ...stored, provider: "tavily" }] }, manchester)).toThrow("Invalid Parallel venue evidence");
    expect(validateDiscoveryPack({ city: "manchester", venues: [{ ...stored, provider: "parallel" }] }, manchester).venues).toHaveLength(1);
  });

  it.each([
    ["Leeds Brewery Tap", "https://www.leeds-live.co.uk/whats-on/food-drink/leeds-brewery-tap", { displayName: "Leeds" }],
    ["Liverpool Arms", "https://www.liverpoolecho.co.uk/whats-on/liverpool-arms", { displayName: "Liverpool" }],
    ["Bristol Beer Factory", "https://www.bristol247.com/food-and-drink/bristol-beer-factory", { displayName: "Bristol" }],
    ["The Bar", "https://barsandpubs.example/the-bar", { displayName: "Manchester" }],
    ["Green Park Brasserie & Bar", "https://green-park-brasserie-and-bar.uk-rest.com/", { displayName: "Bath" }],
  ])("does not treat a news or directory host as %s's own site", (name, url, city) => {
    expect(ownSiteFor(name, url, city)).toBeNull();
  });

  it("treats a host carrying a distinctive word of the name as the venue's own site", () => {
    expect(ownSiteFor("BOX Deansgate", "https://www.theboxbar.co.uk/bars/deansgate", manchester)).toBeNull();
    expect(ownSiteFor("Higher Ground", "https://highergroundmcr.co.uk/", manchester)).toBe("https://highergroundmcr.co.uk/");
  });

  it("reads only permitted pages stating a postcode in the district, listings first by postcode count", () => {
    const results = [
      { url: "https://maps.google.com/place/1", content: "Copper Rooms M1 1AA" },
      { url: "https://copperrooms.example/", content: "Copper Rooms, Manchester M1 1AA", score: 0.5 },
      { url: "https://elsewhere.example/", content: "A bar in Salford M5 4WT" },
      { url: "https://bestbars.example/", content: "Bar one M1 1AA, bar two M1 2BB" },
      { url: "https://www.camra.org.uk/pubs/manchester", content: "Pub one M1 1AA, pub two M1 2BB", score: 0.1 },
    ];
    expect(rankSearchResults(results, "M1")).toEqual(["https://www.camra.org.uk/pubs/manchester", "https://copperrooms.example/"]);
  });

  it.each([
    [{ status: 404 }, true], [{ status: 410 }, true], [{ status: 408 }, false], [{ status: 429 }, false], [{ status: 503 }, false],
    [{ error: "HTTP 404 Not Found" }, true], [{ error: "Failed to fetch url" }, true],
    [{ error: "Request timed out" }, false], [{ error: "Server error 500" }, false], [{ error: "Rate limit exceeded" }, false],
  ])("settles a page read only when it is gone or refused: %j", (failure, definitive) => {
    expect(readFailureIsDefinitive(failure)).toBe(definitive);
  });

  it.each(["--provider=tavily-firecrawl", "--provider=exa", "--provider="])("refuses an unconfigured provider %s before spending", (arg) => {
    expect(() => parseArgs([arg])).toThrow("Invalid provider");
  });
});
