import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import { GET } from "@/app/api/contributors/route";
import {
  __resetCommunityPrices,
  memoryCommunityPriceStore,
} from "@/lib/communityPriceStore";
import {
  __resetVisitReports,
  memoryVisitReportStore,
} from "@/lib/visitReportsStore";
import {
  __resetWeatherRecommendations,
  memoryWeatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";

beforeEach(() => {
  __resetCommunityPrices();
  __resetVisitReports();
  __resetWeatherRecommendations();
  vi.restoreAllMocks();
});

describe("GET /api/contributors", () => {
  it("returns exact combined all-time counts with ties and no private quality trail", async () => {
    await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 5,
        actor: "actor-a",
        contributorHandle: "sam",
      },
      1_000,
    );
    await memoryVisitReportStore.create(
      {
        venueId: "v1",
        handle: "sam",
        visitedAt: "2026-07-27",
        busyness: "steady",
        noise: null,
        seating: null,
        serviceWait: null,
        note: "",
      },
      2_000,
    );
    await memoryWeatherRecommendationStore.create(
      {
        venueId: "v1",
        condition: "warm",
        reason: "The garden keeps the evening light.",
        contributorHandle: "alex",
        actorHash: "actor-b",
      },
      3_000,
    );
    await memoryVisitReportStore.create(
      {
        venueId: "v2",
        handle: "alex",
        visitedAt: "2026-07-26",
        busyness: "quiet",
        noise: null,
        seating: null,
        serviceWait: null,
        note: "",
      },
      4_000,
    );

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(body).toEqual({
      status: "ready",
      window: {
        kind: "all-time",
        label: "All visible contributions, all time",
      },
      entries: [
        {
          rank: 1,
          handle: "alex",
          total: 2,
          prices: 0,
          reviews: 1,
          recommendations: 1,
        },
        {
          rank: 1,
          handle: "sam",
          total: 2,
          prices: 1,
          reviews: 1,
          recommendations: 0,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/quality|actor|corroborated/i);
  });

  it("returns degraded instead of an answered empty or partial board", async () => {
    await memoryCommunityPriceStore.submit(
      {
        venueId: "v1",
        drinkCategory: "beer",
        priceGbp: 5,
        actor: "actor-a",
        contributorHandle: "sam",
      },
      1_000,
    );
    vi.spyOn(
      memoryVisitReportStore,
      "listLeaderboardContributions",
    ).mockRejectedValueOnce(new Error("read unavailable"));

    const response = await GET();
    expect(await response.json()).toEqual({
      status: "degraded",
      window: {
        kind: "all-time",
        label: "All visible contributions, all time",
      },
      entries: [],
    });
  });
});
