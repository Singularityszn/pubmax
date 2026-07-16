import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "fs";
import path from "path";

import sitemap from "@/app/sitemap";
import { listEnabledCities } from "@/lib/cities";
import { listBoroughs } from "@/lib/boroughs";
import { landmarks } from "@/lib/landmarks";
import { loadHistoricPubs } from "@/lib/historic";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import type { MetadataRoute } from "next";

// The number of static hub URLs the generator emits (the fixed list in
// app/sitemap.ts). Kept here so a change to that list is a conscious test edit.
// Includes /pint-index (Wave S3.3 — the London Pint Index hub).
const STATIC_HUB_COUNT = 11;

// Wave S1.2 — sitemap sanity. Runs the real generator against the bundled
// dataset (process.cwd() is the repo root in tests, so public/data/*.json is
// read for real). Asserts the shape and, critically, that NO token/UGC/auth
// surface ever leaks into the sitemap.

const SITE = "https://pubmaxxing.com";

// Every prefix app/robots.ts disallows must be absent from the sitemap.
const FORBIDDEN_SUBSTRINGS = [
  "/api/",
  "/admin",
  "/p/",
  "/rounds/",
  "/plan/",
  "/bar-tab/",
  "/messages",
  "/profile",
  "/activity",
  "/auth",
  "/drinks", // 308-redirects to /discover; must not be advertised
];

// Query strings carry map/crawl tokens; a sitemap URL must be a bare canonical.
// Expected per-family counts, derived from the SAME data sources the generator
// reads — so the test detects real coverage loss (a shrunken dataset, a dropped
// family) without hard-coding a brittle magic total.
type ExpectedCounts = {
  cities: number;
  boroughs: number;
  landmarks: number;
  historic: number;
  venues: number;
  total: number;
};

async function expectedCounts(): Promise<ExpectedCounts> {
  const file = path.join(
    process.cwd(),
    "public",
    "data",
    "pint_prices_app_dataset.json",
  );
  const rows = JSON.parse(await fs.readFile(file, "utf8")) as VenuePrice[];
  const venues = groupVenuePrices(rows);
  const cities = listEnabledCities().filter((c) => c.id !== "london").length;
  const boroughs = listBoroughs(venues).length;
  const historic = (await loadHistoricPubs()).length;
  const counts = {
    cities,
    boroughs,
    landmarks: landmarks.length,
    historic,
    venues: venues.length,
  };
  return {
    ...counts,
    total:
      STATIC_HUB_COUNT +
      counts.cities +
      counts.boroughs +
      counts.landmarks +
      counts.historic +
      counts.venues,
  };
}

describe("sitemap()", () => {
  let entries: MetadataRoute.Sitemap;
  let urls: string[];
  let expected: ExpectedCounts;

  const familyCount = (prefix: string) =>
    urls.filter((u) => u.startsWith(`${SITE}${prefix}`)).length;

  beforeAll(async () => {
    entries = await sitemap();
    urls = entries.map((e) => e.url);
    expected = await expectedCounts();
  });

  it("emits exactly the dataset-derived total (no silent coverage loss)", () => {
    expect(entries.length).toBe(expected.total);
  });

  it("includes the core static hubs", () => {
    for (const hub of ["/", "/map", "/borough", "/historic", "/discover", "/crawls"]) {
      expect(urls).toContain(`${SITE}${hub}`);
    }
  });

  it("emits the promised count for every dynamic family", () => {
    expect(familyCount("/map/")).toBe(expected.cities);
    expect(familyCount("/borough/")).toBe(expected.boroughs);
    expect(familyCount("/landmark/")).toBe(expected.landmarks);
    expect(familyCount("/historic/")).toBe(expected.historic);
    expect(familyCount("/ledger/")).toBe(expected.venues);
    // Sanity floors so a "0 expected" (dataset wipe) can't make the test pass.
    expect(expected.boroughs).toBeGreaterThan(0);
    expect(expected.historic).toBeGreaterThan(0);
    expect(expected.venues).toBeGreaterThan(0);
  });

  it("advertises no token / UGC / auth surface", () => {
    for (const url of urls) {
      for (const bad of FORBIDDEN_SUBSTRINGS) {
        expect(url.includes(bad), `${url} must not contain ${bad}`).toBe(false);
      }
    }
  });

  it("emits absolute, query-free canonical URLs only", () => {
    for (const url of urls) {
      expect(url.startsWith(`${SITE}/`)).toBe(true);
      expect(url).not.toContain("?");
      expect(url).not.toContain("#");
    }
  });

  it("has no duplicate URLs", () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("stamps every entry with a lastModified date", () => {
    for (const entry of entries) {
      expect(entry.lastModified).toBeDefined();
    }
  });
});
