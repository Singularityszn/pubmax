import { describe, it, expect, beforeAll } from "vitest";

import sitemap from "@/app/sitemap";
import type { MetadataRoute } from "next";

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
describe("sitemap()", () => {
  let entries: MetadataRoute.Sitemap;
  let urls: string[];

  beforeAll(async () => {
    entries = await sitemap();
    urls = entries.map((e) => e.url);
  });

  it("emits a healthy number of URLs", () => {
    // static hubs + cities + boroughs + landmarks + historic + venues.
    expect(entries.length).toBeGreaterThan(50);
  });

  it("includes the core static hubs", () => {
    for (const path of ["/", "/map", "/borough", "/historic", "/discover", "/crawls"]) {
      expect(urls).toContain(`${SITE}${path}`);
    }
  });

  it("includes at least one of each dynamic family", () => {
    expect(urls.some((u) => u.startsWith(`${SITE}/borough/`))).toBe(true);
    expect(urls.some((u) => u.startsWith(`${SITE}/historic/`))).toBe(true);
    expect(urls.some((u) => u.startsWith(`${SITE}/landmark/`))).toBe(true);
    expect(urls.some((u) => u.startsWith(`${SITE}/ledger/`))).toBe(true);
    expect(urls.some((u) => u.startsWith(`${SITE}/map/`))).toBe(true);
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
