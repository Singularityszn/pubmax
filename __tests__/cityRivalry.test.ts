import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCityRivalrySnapshot,
  cityRivalryLeaderboard,
  crawlPackCountForCity,
  publishableCityRivalry,
  rankCities,
  rivalryScore,
} from "@/lib/cityRivalry";
import { listEnabledCities } from "@/lib/cities";
import { cityMapShareUrl } from "@/lib/cityShare";
import { demoPintDropsForCity } from "@/lib/pintDropSeeds";
import { defined } from "@/__tests__/helpers/defined";

// Demo content is opt-in (lib/demoContent.ts), and these tests read the seeds.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rivalryScore", () => {
  it("weights drops×3 + crawls×5 + min(venues,200)/10", () => {
    expect(rivalryScore({ dropCount: 10, crawlPackCount: 3, venueCount: 100 })).toBe(
      10 * 3 + 3 * 5 + 100 / 10,
    );
    expect(rivalryScore({ dropCount: 0, crawlPackCount: 0, venueCount: 500 })).toBe(20);
  });
});

describe("rankCities", () => {
  it("sorts by score descending and fills display names", () => {
    const ranked = rankCities([
      {
        cityId: "glasgow",
        dropCount: 0,
        crawlPackCount: 3,
        venueCount: 100,
        tagline: "Subway nights",
      },
      {
        cityId: "london",
        dropCount: 12,
        crawlPackCount: 12,
        venueCount: 200,
        tagline: "Capital crawls",
      },
      {
        cityId: "manchester",
        dropCount: 10,
        crawlPackCount: 3,
        venueCount: 150,
        tagline: "Tram home",
      },
    ]);
    expect(ranked.map((r) => r.cityId)).toEqual(["london", "manchester", "glasgow"]);
    expect(defined(ranked[0]).displayName).toBe("London");
    expect(defined(ranked[0]).score).toBeGreaterThan(defined(ranked[1]).score);
    expect(defined(ranked[2]).dropCount).toBe(0);
  });
});

describe("buildCityRivalrySnapshot / cityRivalryLeaderboard", () => {
  // Inject known venue counts so the test does not depend on reading multi-MB
  // slim JSON in CI — the pure rank path is what we assert.
  const venueOverrides = {
    london: 1033,
    manchester: 544,
    glasgow: 293,
    liverpool: 406,
    oxford: 97,
    durham: 30,
    bristol: 269,
    cambridge: 81,
    bath: 68,
  } as const;

  it("prints nothing while any city lacks a real count (the board today)", () => {
    // No real counter exists yet, so the shipped board is empty and the Pubs
    // and pints tab renders no section (launch review, 30 Oct 2026, item 10).
    expect(buildCityRivalrySnapshot(venueOverrides)).toEqual([]);
    // Demo seed counts are never a drop count, even where seeds ship.
    expect(demoPintDropsForCity("london").length).toBeGreaterThan(0);
    expect(buildCityRivalrySnapshot(venueOverrides)).toEqual([]);
  });

  it("prints nothing when one city's real count is zero or missing", () => {
    const cities = listEnabledCities().map((city) => city.id);
    const allButOne = Object.fromEntries(cities.slice(1).map((id) => [id, 4]));
    expect(buildCityRivalrySnapshot(venueOverrides, allButOne)).toEqual([]);
    expect(buildCityRivalrySnapshot(venueOverrides, { ...allButOne, [defined(cities[0])]: 0 })).toEqual([]);
  });

  it("ranks every enabled city once every one has a real count above zero", () => {
    const cities = listEnabledCities().map((city) => city.id);
    const real = Object.fromEntries(cities.map((id) => [id, id === "london" ? 40 : 2]));
    const board = buildCityRivalrySnapshot(venueOverrides, real);
    expect(board).toHaveLength(cities.length);
    const byId = Object.fromEntries(board.map((e) => [e.cityId, e]));
    expect(defined(byId.london).dropCount).toBe(40);
    expect(defined(byId.london).crawlPackCount).toBe(crawlPackCountForCity("london"));
    expect(defined(board[0]).cityId).toBe("london");
    expect(board.every((e) => e.score === rivalryScore(e))).toBe(true);
  });

  it("publishableCityRivalry refuses a partial board", () => {
    const ranked = rankCities([
      { cityId: "london", dropCount: 3, crawlPackCount: 1, venueCount: 10, tagline: "" },
      { cityId: "bath", dropCount: 0, crawlPackCount: 0, venueCount: 10, tagline: "" },
    ]);
    expect(publishableCityRivalry(ranked)).toEqual([]);
    expect(publishableCityRivalry([])).toEqual([]);
    expect(publishableCityRivalry(ranked.slice(0, 1))).toHaveLength(1);
  });

  it("does not credit London crawl packs to browse-only cities", () => {
    expect(crawlPackCountForCity("liverpool")).toBeGreaterThanOrEqual(3);
    expect(crawlPackCountForCity("oxford")).toBeGreaterThanOrEqual(3);
    expect(crawlPackCountForCity("glasgow")).toBeGreaterThanOrEqual(3);
    expect(crawlPackCountForCity("cambridge")).toBeGreaterThanOrEqual(2);
    expect(crawlPackCountForCity("durham")).toBeGreaterThanOrEqual(2);
    expect(crawlPackCountForCity("bristol")).toBeGreaterThanOrEqual(2);
    expect(crawlPackCountForCity("bath")).toBe(0);
  });

  it("cityRivalryLeaderboard aliases the snapshot", () => {
    const real = Object.fromEntries(listEnabledCities().map((city) => [city.id, 3]));
    expect(cityRivalryLeaderboard(venueOverrides, real)).toEqual(
      buildCityRivalrySnapshot(venueOverrides, real),
    );
  });

  it("rivalry city links use cityMapShareUrl (London /map, others /map/{id})", () => {
    const real = Object.fromEntries(listEnabledCities().map((city) => [city.id, 3]));
    const board = buildCityRivalrySnapshot(venueOverrides, real);
    const byId = Object.fromEntries(board.map((e) => [e.cityId, e]));
    expect(cityMapShareUrl(defined(byId.london).cityId)).toBe("/map");
    expect(cityMapShareUrl(defined(byId.bristol).cityId)).toBe("/map/bristol");
    expect(cityMapShareUrl(defined(byId.manchester).cityId)).toBe("/map/manchester");
    expect(cityMapShareUrl(defined(byId.glasgow).cityId)).toBe("/map/glasgow");
  });
});
