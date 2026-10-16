import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const NICHOLSONS = "https://www.nicholsonspubs.co.uk/restaurants/london";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pubmax-chain-merge-"));
  roots.push(root);
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
  };
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(join(process.cwd(), "scripts/merge_london_chain_scrapes.mjs"), join(root, "scripts/merge_london_chain_scrapes.mjs"));
  const pub = (pub_name: string, address: string, latitude: number, website = "") =>
    ({ pub_name, address, latitude, longitude: -0.14, website });
  write("public/data/pint_prices_app_dataset.json", [
    pub("The Argyll Arms", "18 Argyll Street, London W1F 7TP", 51.51, `${NICHOLSONS}/theargyllarmsoxfordcircuslondon`),
    pub("The Mayflower", "117 Rotherhithe St, London SE16 4NF", 51.5),
    pub("The Grenadier", "Wilton Row, London", 51.501),
    pub("The Spaniards Inn", "Spaniards Road, London NW3", 51.57),
    pub("The Albion", "10 Thornhill Road, London", 51.54),
    pub("The Alma", "499 Old York Road, London SW18 1TF", 51.46, "https://www.thealma.co.uk"),
    pub("The Dukes Head", "8 Lower Richmond Road, London SW15 1JN", 51.467, "https://dukesheadputney.co.uk/"),
    pub("The Bull", "13 North Hill, London N6 4AB", 51.575),
  ]);
  write("data/london_chains/nicholsons/london_pub_urls.json", [
    `${NICHOLSONS}/theargyllarmsoxfordcircuslondon`,
    `${NICHOLSONS}/thecoalholestrandlondon`,
    "https://example.com/",
  ]);
  write("data/london_chains/youngs/garden_pubs_raw.json", [
    { url: "https://www.thealma.co.uk/garden", name: "The Alma", region: "South West", sourcePage: "guide-1" },
    { url: "https://www.dukesheadputney.co.uk/garden", name: "Explore the gardens", region: "South West", sourcePage: "guide-1" },
    { url: "https://www.thebullhighgate.co.uk/garden", name: "The Bull", region: "North", sourcePage: "guide-2" },
    { name: "No link" },
    { url: "not a url", name: "Broken" },
  ]);
  write(".firecrawl/youngs.co.uk-best-pub-gardens-1.md", "The Castle\n[Explore the pub](https://www.castlebattersea.co.uk/garden)\n");
  write(".firecrawl/nicholsonspubs.co.uk-restaurants-london-theargyllarmsoxfordcircuslondon-foodmenu.md", "Fish £15 Pie £14 Chips £5\n");
  write(".firecrawl/eatingeurope.com-blog-londons-pubs.md", "Editorial list\n");
  return root;
}

const run = (root: string) => spawnSync(process.execPath, [join(root, "scripts/merge_london_chain_scrapes.mjs")], {
  cwd: root,
  encoding: "utf8",
});
const read = (root: string, path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

type Match = { venueId: string; venueKey: string; matchedName: string; method: string; score: number };

it("merges the chain scrapes into enrichment links and a match report without inventing prices", () => {
  const root = fixture();
  const first = run(root);
  expect(first.status, first.stderr).toBe(0);

  const { generatedAt, ...report } = read(root, "data/london_chains/match_report.json");
  expect(Date.parse(generatedAt)).not.toBeNaN();
  const key = (name: string, address: string, latitude: number) =>
    `${name.toLowerCase()}|${address.toLowerCase()}|${latitude.toFixed(5)}|-0.14000`;
  const venue = expect.stringMatching(/^venue-[0-9a-z]+$/);
  const nicholsonsEntry = (slug: string, name: string, match: unknown, pricesReliable: boolean) =>
    ({ slug, name, baseUrl: `${NICHOLSONS}/${slug}`, match, pricesReliable, drinkPricesEmitted: false });

  expect(report.archived).toEqual({
    youngs: ["youngs.co.uk-best-pub-gardens-1.md"],
    nicholsons: ["nicholsonspubs.co.uk-restaurants-london-theargyllarmsoxfordcircuslondon-foodmenu.md"],
    eatingeurope: ["eatingeurope.com-blog-londons-pubs.md"],
  });
  expect(report.nicholsons).toEqual({
    total: 3,
    matched: 1,
    unmatched: 2,
    matchedVenues: [nicholsonsEntry("theargyllarmsoxfordcircuslondon", "The Argyll Arms", {
      venueId: venue,
      venueKey: key("The Argyll Arms", "18 Argyll Street, London W1F 7TP", 51.51),
      matchedName: "The Argyll Arms",
      method: "website",
      score: 1,
    }, true)],
    unmatchedPubs: [
      nicholsonsEntry("thecoalholestrandlondon", "The Coal Hole", null, false),
      nicholsonsEntry("example.com", "Example.com", null, false),
    ],
    note: expect.stringContaining("no drink_price_updates invented"),
  });
  const youngsMatch = (name: string, address: string, latitude: number, method: string) => ({
    venueId: venue, venueKey: key(name, address, latitude), matchedName: name, method, score: 1,
  });
  expect(report.youngs).toEqual({
    total: 4,
    matched: 3,
    unmatched: 1,
    matchedVenues: [
      { host: "thealma.co.uk", name: "The Alma", url: "https://www.thealma.co.uk", region: "South West",
        match: youngsMatch("The Alma", "499 Old York Road, London SW18 1TF", 51.46, "website") },
      { host: "dukesheadputney.co.uk", name: "dukesheadputney.co.uk", url: "https://www.dukesheadputney.co.uk", region: "South West",
        match: youngsMatch("The Dukes Head", "8 Lower Richmond Road, London SW15 1JN", 51.467, "website") },
      { host: "thebullhighgate.co.uk", name: "The Bull", url: "https://www.thebullhighgate.co.uk", region: "North",
        match: youngsMatch("The Bull", "13 North Hill, London N6 4AB", 51.575, "fuzzy-name") },
    ],
    unmatchedPubs: [
      { host: "castlebattersea.co.uk", name: "The Castle", url: "https://www.castlebattersea.co.uk", region: null, match: null },
    ],
    beerGardenHints: report.youngs.matchedVenues.map(({ match }: { match: Match }) => ({
      venueId: match.venueId,
      venueKey: match.venueKey,
      hint: "beerGarden",
      source: "youngs.co.uk",
      note: expect.any(String),
    })),
    note: expect.any(String),
  });
  expect(report.eatingeurope).toEqual({
    sourceUrl: "https://www.eatingeurope.com/blog/londons-pubs/",
    governance: "editorial-only — never prices",
    markdownPresent: true,
    matched: 3,
    unmatched: 4,
    matchedVenues: [
      { name: "The Mayflower", venueId: venue, venueKey: key("The Mayflower", "117 Rotherhithe St, London SE16 4NF", 51.5), matchedName: "The Mayflower" },
      { name: "The Spaniards Inn", venueId: venue, venueKey: key("The Spaniards Inn", "Spaniards Road, London NW3", 51.57), matchedName: "The Spaniards Inn" },
      { name: "The Grenadier", venueId: venue, venueKey: key("The Grenadier", "Wilton Row, London", 51.501), matchedName: "The Grenadier" },
    ],
    unmatchedPubs: [
      { name: "Lord Wargrave", postcode: "W1H 5HE" },
      { name: "Ye Old Mitre", postcode: "EC1N 6SJ" },
      { name: "The Albion", postcode: "N1 1HW" },
      { name: "The Ship Soho", postcode: "W1F 0TT" },
    ],
  });
  expect(report.enrichment).toEqual({ path: "public/data/venue_menu_enrichment.json", totalVenues: 4, addedOrUpdated: 4 });

  const argyll = report.nicholsons.matchedVenues[0].match.venueId;
  const [alma, dukes, bull] = report.youngs.matchedVenues.map(({ match }: { match: Match }) => match.venueId);
  const youngsTile = (url: string) => ({
    source: "youngs.co.uk",
    menuUrl: url,
    categoryTiles: [{ id: "garden-1", label: "Pub site", hint: "Young's beer garden pub — opens the official pub website", href: url }],
  });
  const argyllBase = `${NICHOLSONS}/theargyllarmsoxfordcircuslondon`;
  const argyllTiles = {
    source: "nicholsonspubs.co.uk",
    menuUrl: `${argyllBase}/foodmenu`,
    bookingUrl: `${argyllBase}/bookings`,
    categoryTiles: [
      { id: "food-1", label: "Food", hint: "Opens the Nicholson's food menu", href: `${argyllBase}/foodmenu` },
      { id: "drinks-1", label: "Drinks", hint: "Opens the Nicholson's drinks menu", href: `${argyllBase}/drinks` },
    ],
  };
  expect(read(root, "public/data/venue_menu_enrichment.json")).toEqual({
    version: 1,
    venues: {
      [argyll]: argyllTiles,
      [alma]: youngsTile("https://www.thealma.co.uk"),
      [dukes]: youngsTile("https://www.dukesheadputney.co.uk"),
      [bull]: youngsTile("https://www.thebullhighgate.co.uk"),
    },
  });
  expect(JSON.parse(first.stdout)).toEqual({
    nicholsons: { matched: 1, unmatched: 2 },
    youngs: { matched: 3, unmatched: 1 },
    eatingeurope: { matched: 3, unmatched: 4 },
    enrichmentVenues: 4,
    archivedCounts: { youngs: 1, nicholsons: 1, eatingeurope: 1 },
  });

  // Another chain's existing overlay wins, and any other overlay keeps its own fields.
  writeFileSync(join(root, "public/data/venue_menu_enrichment.json"), `${JSON.stringify({
    version: 0,
    venues: {
      [alma]: { source: "greene-king.co.uk", menuUrl: "https://gk.example/alma" },
      [dukes]: { source: "nicholsonspubs.co.uk", menuUrl: "https://nicholsons.example/dukes" },
      [bull]: { source: "curated", menuUrl: "https://old.example/bull", note: "curated note" },
      "venue-unrelated": { source: "curated", menuUrl: "https://unrelated.example/" },
    },
  })}\n`);
  const second = run(root);
  expect(second.status, second.stderr).toBe(0);
  expect(read(root, "public/data/venue_menu_enrichment.json")).toEqual({
    version: 1,
    venues: {
      [alma]: { source: "greene-king.co.uk", menuUrl: "https://gk.example/alma" },
      [dukes]: { source: "nicholsonspubs.co.uk", menuUrl: "https://nicholsons.example/dukes" },
      [bull]: { ...youngsTile("https://www.thebullhighgate.co.uk"), note: "curated note" },
      "venue-unrelated": { source: "curated", menuUrl: "https://unrelated.example/" },
      [argyll]: argyllTiles,
    },
  });
  expect(read(root, "data/london_chains/match_report.json").enrichment).toEqual({
    path: "public/data/venue_menu_enrichment.json",
    totalVenues: 5,
    addedOrUpdated: 4,
  });
});
