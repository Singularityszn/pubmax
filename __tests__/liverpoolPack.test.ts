import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { landmarksForCityAsync } from "@/lib/cityStoryCatalog.async";
import { storyBandsForCity } from "@/lib/cityStoryBands";
import { curatedCrawlsForCity } from "@/lib/cityCuratedCrawls";
import { validateAllStoryBands } from "@/lib/storyBands";
import { CITIES } from "@/lib/cities";
import type { SlimVenue } from "@/lib/venuesSlim";
import type { Poi } from "@/lib/pois";
import { rowsFromSlimPayload } from "@/lib/slimPayload";

const ROOT = path.join(__dirname, "..");
const SLIM_PATH = path.join(
  ROOT,
  "public",
  "data",
  "cities",
  "liverpool",
  "venues_slim.json",
);
const POIS_PATH = path.join(ROOT, "public", "data", "cities", "liverpool", "pois.json");
const DISCOVERIES_PATH = path.join(ROOT, "data", "cities", "liverpool", "parallel_venues.json");

const slim = (rowsFromSlimPayload(JSON.parse(readFileSync(SLIM_PATH, "utf8"))) ?? []) as SlimVenue[];
const slimIds = new Set(slim.map((v) => v.id));

describe("Liverpool editorial pack", () => {
  let landmarks: Awaited<ReturnType<typeof landmarksForCityAsync>> = [];

  beforeAll(async () => {
    landmarks = (await landmarksForCityAsync("liverpool"));
  });
  const bands = storyBandsForCity("liverpool");
  const crawls = curatedCrawlsForCity("liverpool");

  it("ships the ~406 OSM venues plus every sourced discovery", async () => {
    const discoveredIds = new Set<string>(
      (JSON.parse(readFileSync(DISCOVERIES_PATH, "utf8")).venues as { id: string }[]).map((venue) => venue.id),
    );
    const osmRows = slim.filter((venue) => !discoveredIds.has(venue.id));
    expect(osmRows.length).toBeGreaterThanOrEqual(400);
    expect(osmRows.length).toBeLessThanOrEqual(420);
    expect(slim.length).toBe(osmRows.length + discoveredIds.size);
  });

  it("ships ≥8 sourced landmarks", async () => {
    expect(landmarks.length).toBeGreaterThanOrEqual(8);
    expect(new Set(landmarks.map((l) => l.id)).size).toBe(landmarks.length);
    for (const landmark of landmarks) {
      expect(landmark.name.trim().length).toBeGreaterThan(0);
      expect(landmark.history.trim().split(/\s+/).length).toBeGreaterThanOrEqual(12);
      expect(landmark.source.url).toMatch(/^https?:\/\//);
      expect(landmark.coordinates).toHaveLength(2);
      const [lng, lat] = landmark.coordinates;
      expect(lat).toBeGreaterThan(53.35);
      expect(lat).toBeLessThan(53.48);
      expect(lng).toBeGreaterThan(-3.05);
      expect(lng).toBeLessThan(-2.85);
    }
  });

  it("includes match-day orientation landmarks without tribal bait copy", async () => {
    expect(landmarks.some((l) => l.id === "anfield-stadium")).toBe(true);
    expect(landmarks.some((l) => l.id === "goodison-park")).toBe(true);
    const matchCopy = landmarks
      .filter((l) => l.id === "anfield-stadium" || l.id === "goodison-park")
      .map((l) => l.history.toLowerCase())
      .join(" ");
    expect(matchCopy).toMatch(/orientation|logistics|timing/);
    expect(matchCopy).not.toMatch(/\b(scum|hate|rivalry|die.?hard)\b/);
  });

  it("ships ≥3 valid story bands anchored to Liverpool landmarks", async () => {
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(bands.map((b) => b.id)).toEqual(
      expect.arrayContaining([
        "match-day-anfield",
        "ropewalks-baltic",
        "victorian-opulence",
      ]),
    );
    expect(validateAllStoryBands(bands, landmarks)).toEqual({});
    const matchBand = bands.find((b) => b.id === "match-day-anfield");
    expect(matchBand?.copy.toLowerCase()).toMatch(/logistics|timing|merseyrail/);
    expect(matchBand?.copy.toLowerCase()).not.toMatch(/\b(scum|hate|die.?hard)\b/);
  });

  it("ships ≥2 curated crawls whose stop ids exist in the Liverpool slim index", async () => {
    expect(crawls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(crawls.map((c) => c.id)).size).toBe(crawls.length);
    expect(crawls.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "match-day-warm-up",
        "victorian-tiled-giants",
        "baltic-first-night",
      ]),
    );
    for (const crawl of crawls) {
      expect(crawl.venueIds.length).toBeGreaterThanOrEqual(3);
      expect(crawl.venueIds.length).toBeLessThanOrEqual(6);
      expect(new Set(crawl.venueIds).size).toBe(crawl.venueIds.length);
      for (const venueId of crawl.venueIds) {
        expect(slimIds.has(venueId), `${crawl.id} missing slim id ${venueId}`).toBe(true);
      }
      if (crawl.startLandmarkId) {
        expect(
          landmarks.some((lm) => lm.id === crawl.startLandmarkId),
          `${crawl.id} startLandmarkId ${crawl.startLandmarkId}`,
        ).toBe(true);
      }
      if (crawl.placeStoryBandId) {
        expect(
          bands.some((b) => b.id === crawl.placeStoryBandId),
          `${crawl.id} placeStoryBandId ${crawl.placeStoryBandId}`,
        ).toBe(true);
      }
    }
  });

  it("keeps London selectors on the London catalogs", async () => {
    expect((await landmarksForCityAsync("london")).some((l) => l.id === "tower-bridge")).toBe(true);
    expect(storyBandsForCity("london")).toHaveLength(6);
    expect(curatedCrawlsForCity("london").length).toBeGreaterThanOrEqual(3);
    expect((await landmarksForCityAsync("liverpool")).some((l) => l.id === "tower-bridge")).toBe(false);
  });

  it("points CityConfig.poisPath at a valid Liverpool POI seed", async () => {
    expect(CITIES.liverpool.poisPath).toBe("/data/cities/liverpool/pois.json");
    const pois = JSON.parse(readFileSync(POIS_PATH, "utf8")) as Poi[];
    expect(pois.length).toBeGreaterThanOrEqual(15);
    expect(pois.length).toBeLessThanOrEqual(40);
    const names = pois.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Liverpool Lime Street",
        "Liverpool Central",
        "James Street (Merseyrail)",
        "Moorfields (Merseyrail)",
        "Sandhills (Merseyrail)",
      ]),
    );
    for (const poi of pois) {
      expect(poi.id.length).toBeGreaterThan(0);
      expect(poi.name.length).toBeGreaterThan(0);
      expect(poi.coordinates).toHaveLength(2);
    }
  });
});
