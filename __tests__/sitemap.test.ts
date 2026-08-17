import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { execFileSync } from "node:child_process";
import { promises as fs } from "fs";
import path, { join } from "path";

import registry from "@/data/freshness_registry.json";
import sitemap from "@/app/sitemap";
import { listEnabledCities } from "@/lib/cities";
import { listBoroughs } from "@/lib/boroughs";
import { landmarks } from "@/lib/landmarks";
import { loadHistoricPubs } from "@/lib/historic";
import { loadPintIndexArchive } from "@/lib/pintIndexSnapshot.server";
import { loadDrinkBrandLandings } from "@/lib/drinkBrandLanding.server";
import { loadDrinkBrandAreaLandings } from "@/lib/drinkBrandAreaLanding.server";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import type { MetadataRoute } from "next";

// The number of static hub URLs the generator emits (the fixed list in
// app/sitemap.ts). Kept here so a change to that list is a conscious test edit.
// Includes /pint-index (Wave S3.3 — the London Pint Index hub), /about
// (founder story + press kit hub), /founders (the numbered public wall of the
// first hundred claimed handles) and the two legal content pages
// (/privacy, /terms) linked from the site footer.
const STATIC_HUB_COUNT = 14;

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
  "/discover",
  "/drinks",
  "/feed",
  "/stories",
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
  editions: number;
  drinkBrands: number;
  drinkBrandAreas: number;
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
  // One URL per dated Pint Index edition actually published.
  const editions = (await loadPintIndexArchive()).length;
  // Governed landing pages come from the SAME loaders the routes render, so a
  // page the sitemap advertises is a page that exists.
  const drinkBrands = (await loadDrinkBrandLandings()).length;
  const drinkBrandAreas = (await loadDrinkBrandAreaLandings()).length;
  const counts = {
    cities,
    boroughs,
    landmarks: landmarks.length,
    historic,
    venues: venues.length,
    editions,
    drinkBrands,
    drinkBrandAreas,
  };
  return {
    ...counts,
    total:
      STATIC_HUB_COUNT +
      counts.cities +
      counts.boroughs +
      counts.landmarks +
      counts.historic +
      counts.venues +
      counts.editions +
      counts.drinkBrands +
      counts.drinkBrandAreas,
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

  it("lists every dated Pint Index edition, and the live index too", () => {
    expect(urls).toContain(`${SITE}/pint-index`);
    expect(familyCount("/pint-index/")).toBe(expected.editions);
    expect(expected.editions).toBeGreaterThan(0);
  });

  it("includes the core static hubs", () => {
    for (const hub of ["/", "/map", "/borough", "/historic", "/social", "/crawls", "/about"]) {
      expect(urls).toContain(`${SITE}${hub}`);
    }
  });

  it("emits the promised count for every dynamic family", () => {
    expect(familyCount("/map/")).toBe(expected.cities);
    expect(familyCount("/borough/")).toBe(expected.boroughs);
    expect(familyCount("/landmark/")).toBe(expected.landmarks);
    expect(familyCount("/historic/")).toBe(expected.historic);
    expect(familyCount("/ledger/")).toBe(expected.venues);
    expect(familyCount("/drink/")).toBe(expected.drinkBrands);
    expect(familyCount("/area/")).toBe(expected.drinkBrandAreas);
    expect(expected.drinkBrands).toBeGreaterThan(0);
    expect(expected.drinkBrandAreas).toBeGreaterThan(0);
    // Sanity floors so a "0 expected" (dataset wipe) can't make the test pass.
    expect(expected.boroughs).toBeGreaterThan(0);
    expect(expected.historic).toBeGreaterThan(0);
    expect(expected.venues).toBeGreaterThan(0);
  });

  it("advertises no /area/{slug} page, because that family is held", () => {
    // The brand-by-area pages live UNDER /area/{slug}, but the area page itself
    // duplicates /borough/{slug} and is not published. Advertising one would be
    // advertising a 404.
    for (const url of urls.filter((candidate) => candidate.includes("/area/"))) {
      expect(url).toMatch(/\/area\/[^/]+\/drink\/[^/]+$/);
    }
  });

  it("advertises no /out page, because it duplicates /tonight's claim", () => {
    // /out lists the same baseline What's-On rows /tonight already publishes for
    // the same city, so it ships noindex (app/out/page.tsx) until L2 and L4 give
    // it content of its own. A sitemap entry would vouch for the duplicate.
    expect(urls).not.toContain(`${SITE}/out`);
    expect(urls).toContain(`${SITE}/tonight`);
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

describe("sitemap() when historic data is unavailable", () => {
  it("omits historic URLs, logs an alert, and still emits the price-derived graph", async () => {
    vi.resetModules();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("@/lib/historic", () => ({
      loadHistoricPubs: async () => [],
    }));

    const degraded = (await import("@/app/sitemap")).default;
    const degradedEntries = await degraded();
    const degradedUrls = degradedEntries.map((e) => e.url);

    expect(familyCountFrom(degradedUrls, "/historic/")).toBe(0);
    expect(degradedUrls.some((u) => u.includes("/ledger/"))).toBe(true);
    expect(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("[freshness-audit][ALERT]") &&
        String(call[0]).includes("sitemap historic degrade") &&
        String(call[0]).includes("historic"),
      ),
    ).toBe(true);

    errorSpy.mockRestore();
    vi.doUnmock("@/lib/historic");
    vi.resetModules();
  });

  // The degrade above may only be the RARE outcome. lib/historic.ts opens the
  // pack from process.cwd() at request time, so if the file is not declared for
  // this function, a lambda-grouping change drops all 346 /historic/{slug} URLs
  // on every generation and the alert becomes noise. Evaluating the real config
  // the way Next does also proves it still loads.
  it("ships the historic pack with the sitemap function, so the degrade is a fallback", () => {
    const root = join(__dirname, "..");
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const m = await import(process.argv[1]);" +
          "console.log(JSON.stringify(m.default.outputFileTracingIncludes ?? null));",
        join(root, "next.config.mjs"),
      ],
      { cwd: root, encoding: "utf8" },
    );
    const includes = JSON.parse(out) as Record<string, string[]>;
    expect(includes["/sitemap.xml"]).toContain("./public/data/historic_pubs.json");
    // The pack the sitemap ships and the one the freshness audit ages are the
    // same file, taken from the registry by id rather than typed twice.
    const registered = (
      registry.datasets as Array<{ id: string; artifact: string | null }>
    ).find((d) => d.id === "historic_pubs");
    expect(includes["/sitemap.xml"]).toContain(`./${registered?.artifact}`);
  });

  function familyCountFrom(urls: string[], prefix: string) {
    return urls.filter((u) => u.startsWith(`${SITE}${prefix}`)).length;
  }
});
