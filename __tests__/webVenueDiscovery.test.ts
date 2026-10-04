import { describe, expect, it } from "vitest";
import { parseTaskVenues } from "../scripts/lib/parallelVenueDiscovery.mjs";
import { ownSiteFor, rankSearchResults, webPageResult } from "../scripts/lib/webVenueDiscovery.mjs";
import { parseArgs } from "../scripts/discover_parallel_venues.mjs";

const city = { id: "manchester", displayName: "Manchester", bbox: [53.38, -2.35, 53.55, -2.1] as [number, number, number, number] };
const page = "# Copper Rooms\n\nCopper Rooms cocktail bar, [12 Test Street](https://copperrooms.example/find-us), Manchester M1 1AA.\n\n![logo](https://copperrooms.example/logo.png)";
const extracted = (excerpt: string, website: string | null = "https://copperrooms.example/") => ({ venues: [{
  name: "Copper Rooms", kind: "bar", address: "12 Test Street, Manchester M1 1AA", website, lat: null, lng: null,
  evidence: [{ url: "https://elsewhere.example/", excerpt }],
}] });

describe("Tavily and Firecrawl venue discovery", () => {
  it("accepts a venue only on words its own scraped page states, cited to the landed page", () => {
    const result = webPageResult({ landedUrl: "https://copperrooms.example/", markdown: page, json: extracted("Copper Rooms cocktail bar, 12 Test Street, Manchester M1 1AA.") });
    const parsed = parseTaskVenues(result, city, "2026-10-04T10:00:00Z");
    expect(parsed.candidates).toMatchObject([{ name: "Copper Rooms", postcode: "M1 1AA", sourceUrls: ["https://copperrooms.example/"] }]);
  });
  it("rejects an extracted excerpt the page never states", () => {
    const result = webPageResult({ landedUrl: "https://copperrooms.example/", markdown: page, json: extracted("Copper Rooms cocktail bar, 99 Invented Street, Manchester M1 1AA.") });
    expect(parseTaskVenues(result, city, "2026-10-04T10:00:00Z").rejected).toEqual([{ name: "Copper Rooms", reason: "missing-venue-specific-citation" }]);
  });
  it("rejects a venue read from a page that is neither its own site nor a venue listing", () => {
    const result = webPageResult({ landedUrl: "https://bestbars.example/manchester", markdown: page, json: extracted("Copper Rooms cocktail bar, 12 Test Street, Manchester M1 1AA.") });
    expect(parseTaskVenues(result, city, "2026-10-04T10:00:00Z").candidates).toEqual([]);
  });
  it("does not let the extractor declare a multi-venue article to be a venue's own site", () => {
    const article = "Where to watch: The Royal Oak, 440 Barlow Moor Rd, Chorlton-cum-Hardy, Manchester M21 0BQ, an old-fashioned pub.";
    const json = { venues: [{ name: "The Royal Oak", kind: "pub", address: "440 Barlow Moor Rd, Chorlton-cum-Hardy, Manchester M21 0BQ", website: "https://footballgroundguide.com/", lat: null, lng: null,
      evidence: [{ url: "https://footballgroundguide.com/news/where-to-watch", excerpt: article }] }] };
    const result = webPageResult({ landedUrl: "https://footballgroundguide.com/news/where-to-watch", markdown: article, json });
    expect(parseTaskVenues(result, city, "2026-10-04T10:00:00Z").candidates).toEqual([]);
  });
  it.each([
    ["BOX Deansgate", "https://www.theboxbar.co.uk/bars/deansgate", "https://www.theboxbar.co.uk/"],
    ["The Royal Oak", "https://footballgroundguide.com/news/x", null],
    ["The Bar", "https://barsandpubs.example/the-bar", null],
  ])("treats %s on %s as own site %s", (name, url, site) => {
    expect(ownSiteFor(name, url)).toBe(site);
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
  it.each(["--provider=exa", "--provider="])("refuses an unconfigured provider %s before spending", (arg) => {
    expect(() => parseArgs([arg])).toThrow("Invalid provider");
  });
});
