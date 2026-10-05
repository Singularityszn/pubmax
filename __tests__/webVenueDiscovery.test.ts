import { describe, expect, it } from "vitest";
import { ownSiteFor, parseTaskVenues, statesDrinking, validateDiscoveryPack } from "../scripts/lib/parallelVenueDiscovery.mjs";
import { nonVenueSource, rankSearchResults, readFailureIsDefinitive, webPageResult } from "../scripts/lib/webVenueDiscovery.mjs";
import { parseArgs } from "../scripts/discover_parallel_venues.mjs";
import { defined } from "@/__tests__/helpers/defined";

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
    expect(defined(defined(parsed.candidates[0]).evidence[0]).excerpt).toContain("Copper Rooms");
    expect(defined(defined(parsed.candidates[0]).evidence[0]).excerpt).toContain("M3 2BY");
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
    const text = "7. The Gin Bar\nCocktail bar\nWhere: 2-3 Queen Street M3 1HE\n\nSunday until 10am. Restaurant daily 11am to 10pm\nBar to 12.30am. Court Lane, Manchester M3 2AW";
    expect(read("https://www.designmynight.com/manchester/bars", text).candidates.map((row) => [row.name, row.address])).toEqual([["The Gin Bar", "2-3 Queen Street M3 1HE"]]);
  });

  it.each([
    ["Fuzion Noodle Bar", "264 Wilmslow Road", "Noodles, ramen and bubble tea."],
    ["Sakura Sushi Bar", "12 Oxford Road", "Fresh sushi, bento boxes and green tea."],
    ["Squeeze Juice Bar", "8 Peter Street", "Cold-pressed juices and smoothies."],
    ["Smokestack Bar & Grill", "3 Quay Street", "Burgers, wings and bubble tea shakes."],
  ])("does not read %s as a drinking venue from its name alone", (name, street, blurb) => {
    const host = name.toLowerCase().split(" ")[0];
    const text = `**${name}**\n\n${street}\n\nManchester\n\nM3 2BY\n\n${blurb}`;
    expect(read(`https://www.${host}.example/`, text, `${name} | Home`).candidates).toEqual([]);
  });

  it.each([
    ["Merlin's Café Bar", "Merlins Café Bar\nopen DAYS : TIMES VARY\nLocation : BIRMINGHAM 2 Test Street B1 1AA"],
    ["The Bath Distillery Gin Bar", "### **7. The Bath****Distillery Gin Bar**\n2-3 Queen Street BA1 1HE"],
    ["The Cut & Craft", "THE CUT AND CRAFT 23 King Edward St LS1 6AX"],
    ["Café Bar Nº1", "Cafe Bar No1, 1 High Street M1 1AA"],
  ])("does not take %s's name for drinking evidence however the quote spells it", (name, quote) => {
    expect(statesDrinking("bar", quote, name)).toBe(false);
    expect(statesDrinking("bar", `${quote}\nCask ales and cocktails`, name)).toBe(true);
  });

  it("withdraws a stored Parallel row and refuses a parsed one whose only drinking word is a respelled name", () => {
    const url = "https://merlinscafe.example/";
    const excerpt = "Merlins Café Bar, 2 Test Street, Birmingham B1 1AA";
    const birmingham = { id: "birmingham", displayName: "Birmingham", bbox: [52.42, -1.98, 52.55, -1.8] as [number, number, number, number] };
    const row = { name: "Merlin's Café Bar", kind: "bar", address: "2 Test Street, Birmingham B1 1AA", website: url, lat: null, lng: null, evidence: [{ url, excerpt }] };
    const result = { output: { type: "json", content: { venues: [row] }, basis: [{ field: "venues.0", confidence: "high", citations: [{ url, excerpts: [excerpt] }] }] } };
    expect(parseTaskVenues(result, birmingham, observedAt).rejected).toEqual([{ name: "Merlin's Café Bar", reason: "missing-drinking-evidence" }]);
    const stored = { ...row, postcode: "B1 1AA", locality: "Birmingham", sourceUrls: [url], observedAt, lat: 52.48, lng: -1.9, coordinatePrecision: "postcode-centroid", provider: "parallel" };
    expect(() => validateDiscoveryPack({ city: "birmingham", venues: [stored] }, birmingham)).toThrow("Invalid Parallel venue evidence");
  });

  it.each([
    ["https://democracy.manchester.gov.uk/documents/s1/report.pdf", "public body or academic site"],
    ["https://www.leedsbeckett.ac.uk/events", "public body or academic site"],
    ["https://www.postcodearea.co.uk/postaltowns/manchester/m54rp", "postcode or property lookup"],
    ["https://www.carehome.co.uk/care_search_results.cfm/searchpostcode/B21", "care or childcare directory"],
    ["https://www.simplyhired.co.uk/search?q=bartender&l=leeds", "job board"],
    ["https://www.stagecoachbus.com/promos", "transport operator"],
    ["https://uk.hotels.com/ho1/the-dark-horse", "travel aggregator"],
    ["https://camra.org.uk/pubs/place/cowley", null],
    ["https://www.visitliverpool.com/listing/salt-and-tar/62741101", null],
    ["https://www.cricketersarmsoxford.co.uk/", null],
  ])("filters %s as %s before reading", (url, reason) => {
    expect(nonVenueSource(url)).toBe(reason);
  });

  it("reads drinking identity stated outside the name", () => {
    const pub = "**Smokestack Bar & Grill**\n\n3 Quay Street\n\nManchester\n\nM3 2BY\n\nCraft beers on draught and cocktails until late.";
    expect(read("https://www.smokestack.example/", pub, "Smokestack Bar & Grill").candidates).toMatchObject([{ name: "Smokestack Bar & Grill", kind: "bar" }]);
    const listing = ["Noodle Hall", "Pub, in Salford", "Cask Ale", "4 Mill Street, Salford, M3 6BB"].join("\n");
    expect(read("https://camra.org.uk/pubs/location/salford", listing).candidates).toMatchObject([{ name: "Noodle Hall", kind: "pub" }]);
  });

  it("withdraws a stored row whose only drinking word is its name", () => {
    const row = { name: "Fuzion Noodle Bar", kind: "bar", address: "264 Wilmslow Road, Fallowfield M14 6JR", postcode: "M14 6JR", locality: "Manchester", website: "https://fuzionnoodlebar.co.uk/",
      sourceUrls: ["https://fuzionnoodlebar.co.uk/"], evidence: [{ url: "https://fuzionnoodlebar.co.uk/", excerpt: "Fuzion Noodle Bar | 264 Wilmslow Road Fallowfield M14 6JR" }],
      observedAt, lat: 53.44, lng: -2.22, coordinatePrecision: "postcode-centroid" };
    expect(() => validateDiscoveryPack({ city: "manchester", venues: [{ ...row, provider: "tavily" }] }, manchester)).toThrow("Invalid Parallel venue evidence");
    expect(() => validateDiscoveryPack({ city: "manchester", venues: [{ ...row, provider: "parallel" }] }, manchester)).toThrow("Invalid Parallel venue evidence");
    const stated = { ...row, evidence: [...row.evidence, { url: row.sourceUrls[0], excerpt: "Asian beers and cocktails served all day" }] };
    expect(validateDiscoveryPack({ city: "manchester", venues: [{ ...stated, provider: "tavily" }] }, manchester).venues).toHaveLength(1);
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
    const result = { output: { type: "json", content: { venues: [row] }, basis: [{ field: "venues.0", confidence: "high", citations: [{ url: defined(row.evidence[0]).url, excerpts: [page] }] }] } };
    expect(parseTaskVenues(result, manchester, observedAt, { local: true }).rejected).toEqual([{ name: "Bar A", reason: "citation-does-not-bind-name-and-address" }]);
    expect(parseTaskVenues(result, manchester, observedAt).candidates).toHaveLength(1);
    const stored = { ...row, postcode: "M3 2BB", locality: "Manchester", sourceUrls: [defined(row.evidence[0]).url], observedAt, lat: 53.48, lng: -2.25, coordinatePrecision: "postcode-centroid" };
    expect(() => validateDiscoveryPack({ city: "manchester", venues: [{ ...stored, provider: "tavily" }] }, manchester)).toThrow("Invalid Parallel venue evidence");
    expect(validateDiscoveryPack({ city: "manchester", venues: [{ ...stored, provider: "parallel" }] }, manchester).venues).toHaveLength(1);
  });

  it.each([
    ["Leeds Brewery Tap", "https://www.leeds-live.co.uk/whats-on/food-drink/leeds-brewery-tap", { displayName: "Leeds" }],
    ["Liverpool Arms", "https://www.liverpoolecho.co.uk/whats-on/liverpool-arms", { displayName: "Liverpool" }],
    ["Bristol Beer Factory", "https://www.bristol247.com/food-and-drink/bristol-beer-factory", { displayName: "Bristol" }],
    ["The Bar", "https://barsandpubs.example/the-bar", { displayName: "Manchester" }],
    ["Green Park Brasserie & Bar", "https://green-park-brasserie-and-bar.uk-rest.com/", { displayName: "Bath" }],
    ["Echo Bar", "https://www.liverpoolecho.co.uk/whats-on/echo-bar", { displayName: "Liverpool" }],
    ["Trip Lounge", "https://uk.trip.com/restaurant/trip-lounge", { displayName: "Liverpool" }],
    ["Echo Arms", "https://whatson.liverpoolecho.co.uk/echo-arms", { displayName: "Liverpool" }],
    ["Evening Star", "https://www.manchestereveningnews.co.uk/whats-on/evening-star", { displayName: "Manchester" }],
    ["Postal Bar", "https://www.bristolpost.co.uk/whats-on/postal-bar", { displayName: "Bristol" }],
    ["Mailbox Tap", "https://www.birminghammail.co.uk/whats-on/mailbox-tap", { displayName: "Birmingham" }],
    ["Livewire Bar", "https://www.glasgowlive.co.uk/whats-on/livewire", { displayName: "Glasgow" }],
    ["Evening Post Inn", "https://www.yorkshireeveningpost.co.uk/whats-on/evening-post-inn", { displayName: "Leeds" }],
  ])("does not treat a news or directory host as %s's own site", (name, url, city) => {
    expect(ownSiteFor(name, url, city)).toBeNull();
  });

  it.each([
    ["The Lamp Post", "https://www.thelamppost.co.uk/", { displayName: "Manchester" }],
    ["New Street Tavern", "https://newstreettavern.co.uk/", { displayName: "Birmingham" }],
    ["The Olive Tree", "https://theolive.co.uk/", { displayName: "Bath" }],
    ["The Signpost", "https://thesignpost.pub/", { displayName: "Leeds" }],
    ["The Lamp Post", "https://www.the-lamp-post.co.uk/", { displayName: "Manchester" }],
    ["Royal Standard", "https://royal-standard-pub.co.uk/", { displayName: "Oxford" }],
    ["Live Lounge Bar", "https://live-lounge-bar.com/", { displayName: "Bristol" }],
    ["Trip Inn", "https://trip-inn.co.uk/", { displayName: "Bath" }],
  ])("keeps %s's own site although its name holds a news word", (name, url, city) => {
    expect(ownSiteFor(name, url, city)).toBe(url);
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
    [{ error: "HTTP 404 Not Found" }, true], [{ error: "Failed to fetch url" }, false], [{ error: "Error fetching content" }, false],
    [{ error: "Request timed out" }, false], [{ error: "Server error 500" }, false], [{ error: "Rate limit exceeded" }, false],
  ])("settles a page read by itself only when it is gone: %j", (failure, definitive) => {
    expect(readFailureIsDefinitive(failure)).toBe(definitive);
  });

  it.each(["--provider=tavily-firecrawl", "--provider=exa", "--provider="])("refuses an unconfigured provider %s before spending", (arg) => {
    expect(() => parseArgs([arg])).toThrow("Invalid provider");
  });
});
