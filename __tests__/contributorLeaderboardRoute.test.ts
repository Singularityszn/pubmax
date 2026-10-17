import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

// A ready board and a failing avatar lookup are stood in for here; every other
// case reads the real keyless store, which is degraded by construction.
const boardState = vi.hoisted(() => ({
  board: null as import("@/lib/contributorLeaderboard").ContributorLeaderboard | null,
  enrichFails: false,
}));
vi.mock("@/lib/contributorLeaderboardStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contributorLeaderboardStore")>();
  return {
    ...actual,
    readContributorLeaderboard: async () => boardState.board ?? actual.readContributorLeaderboard(),
    enrichContributorBoard: async (board: Parameters<typeof actual.enrichContributorBoard>[0]) => {
      if (boardState.enrichFails) throw new Error("profile handle batch read failed");
      return actual.enrichContributorBoard(board);
    },
  };
});

import { GET as routeGET } from "@/app/api/contributors/route";
import { __resetPintDrops } from "@/lib/pintDrops";
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

function GET(ip = "203.0.113.7"): Promise<Response> {
  return routeGET(
    new Request("http://localhost/api/contributors", { headers: { "x-forwarded-for": ip } }),
  );
}

const READY_BOARD = {
  status: "ready",
  window: {
    kind: "all-time",
    label: "All visible identity-backed contributions, all time",
  },
  entries: [{ rank: 1, handle: "sam", total: 3, prices: 2, reviews: 1, recommendations: 0 }],
} as const;

beforeEach(() => {
  boardState.board = null;
  boardState.enrichFails = false;
  __resetPintDrops();
  __resetCommunityPrices();
  __resetVisitReports();
  __resetWeatherRecommendations();
  vi.restoreAllMocks();
});

describe("GET /api/contributors", () => {
  it("refuses to present process-memory contributions as an all-time record", async () => {
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
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/quality|actor|corroborated/i);
  });

  it("keeps an empty keyless record unavailable rather than implying absence", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({
      status: "degraded",
      window: {
        kind: "unavailable",
        label: "All-time record unavailable",
      },
      entries: [],
    });
  });

  it("never holds a ready board at the edge, so a withdrawn contributor leaves it on the next read", async () => {
    boardState.board = { ...READY_BOARD, entries: [...READY_BOARD.entries] };
    const response = await GET();
    expect(response.status).toBe(200);
    const cacheControl = response.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).not.toContain("s-maxage");
    expect(await response.json()).toMatchObject({ status: "ready", entries: [{ handle: "sam" }] });
  });

  it("answers the board without avatars when the avatar lookup throws, never a bare 500", async () => {
    boardState.board = { ...READY_BOARD, entries: [...READY_BOARD.entries] };
    boardState.enrichFails = true;
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.entries).toEqual([
      { rank: 1, handle: "sam", total: 3, prices: 2, reviews: 1, recommendations: 0 },
    ]);
  });

  it("spends a per-address budget, so one caller cannot run the leaderboard read on a loop", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 61; i += 1) last = await GET("198.51.100.4");
    expect(last?.status).toBe(429);
    expect((await last!.json()).code).toBe("RATE_LIMITED");
    // Another address still has its own budget.
    expect((await GET("198.51.100.5")).status).toBe(200);
  });
});
