import { beforeEach, describe, expect, it, vi } from "vitest";

const venueState = vi.hoisted(() => ({
  unavailable: false,
  kind: "pub" as "pub" | "bar",
}));

vi.mock("@/lib/venueIndex", () => ({
  lookupCanonicalVenue: async (id: string) => {
    const canonicalId = id === "venue-legacy" ? "venue-test" : id;
    if (venueState.unavailable) {
      return { status: "unavailable" as const, canonicalId };
    }
    if (canonicalId !== "venue-test") {
      return { status: "unknown" as const, canonicalId };
    }
    return {
      status: "found" as const,
      canonicalId,
      venue: {
        id: canonicalId,
        name: "The Test Arms",
        borough: "Soho",
        lat: 51.511,
        lng: -0.134,
        kind: venueState.kind,
      },
    };
  },
}));

const weatherState = vi.hoisted(() => ({
  snapshot: null as import("@/lib/weatherSnapshots").WeatherSnapshot | null,
}));

vi.mock("@/lib/weatherSnapshots.server", () => ({
  loadWeatherSnapshot: async () => weatherState.snapshot,
}));

vi.mock("@/lib/messageAuth", () => ({
  resolveMessageHandle: async (
    _request: Request,
    assertedHandle: string,
  ) => assertedHandle,
}));

vi.mock("@/lib/profileOwnership", () => ({
  gateHandleAction: async (_request: Request, handle: string) => ({
    allowed: true as const,
    callerUserId: null,
    handle,
  }),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import {
  GET,
  POST,
  WEATHER_RECOMMENDATION_RESPONSE_BUDGET_BYTES,
} from "@/app/api/weather-recommendations/route";
import { __resetPintDrops } from "@/lib/pintDrops";
import {
  __resetWeatherRecommendations,
  memoryWeatherRecommendationStore,
} from "@/lib/weatherRecommendationStore";
import type { WeatherSnapshot } from "@/lib/weatherSnapshots";

function snapshot(
  overrides: Partial<WeatherSnapshot["observations"][number]> = {},
): WeatherSnapshot {
  return {
    version: 1,
    generatedAt: "2026-07-28T00:00:00.000Z",
    observations: [
      {
        nightArea: "piccadilly-soho",
        observedAt: "2026-07-28T00:00:00.000Z",
        expiresAt: "2099-07-29T00:00:00.000Z",
        condition: "Clear",
        feelsLikeC: 20,
        precipitationProbabilityPct: 5,
        windKph: 8,
        source: {
          sourceUrl: "https://api.open-meteo.com/v1/forecast?test",
          publisher: "Open-Meteo",
          publishedAt: "2026-07-28T00:00:00.000Z",
        },
        ...overrides,
      },
    ],
  };
}

function post(body: unknown, ip = "198.51.100.4"): Request {
  return new Request("http://localhost/api/weather-recommendations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

function get(venueId = "venue-test"): Request {
  return new Request(
    `http://localhost/api/weather-recommendations?venueId=${encodeURIComponent(venueId)}`,
  );
}

beforeEach(() => {
  venueState.unavailable = false;
  venueState.kind = "pub";
  weatherState.snapshot = snapshot();
  __resetPintDrops();
  __resetWeatherRecommendations();
});

describe("POST /api/weather-recommendations", () => {
  it("stores a validated, canonical, attributed opinion", async () => {
    const response = await POST(
      post({
        venueId: "venue-legacy",
        condition: "warm",
        reason: "The back garden catches the evening light.",
        contributorHandle: "@Night_Owl",
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      recommendation: Record<string, unknown>;
    };
    expect(body.recommendation).toMatchObject({
      venueId: "venue-test",
      condition: "warm",
      reason: "The back garden catches the evening light.",
      contributorHandle: "night_owl",
      source: "community",
    });
    expect(body.recommendation.submittedAt).toEqual(expect.any(Number));
    expect(JSON.stringify(body)).not.toContain("actor");
  });

  it("ignores client-supplied provenance and clock fields", async () => {
    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "cold",
        reason: "The front snug keeps the draught out.",
        contributorHandle: "night_owl",
        source: "verified",
        submittedAt: 1,
        actorHash: "client-lie",
      }),
    );
    const body = (await response.json()) as {
      recommendation: { source: string; submittedAt: number };
    };

    expect(response.status).toBe(201);
    expect(body.recommendation.source).toBe("community");
    expect(body.recommendation.submittedAt).toBeGreaterThan(1);
    expect(JSON.stringify(body)).not.toContain("client-lie");
  });

  it("rejects unknown conditions, short reasons, and unknown venues", async () => {
    expect(
      (
        await POST(
          post({
            venueId: "venue-test",
            condition: "snowy",
            reason: "Snow settles outside.",
            contributorHandle: "night_owl",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post({
            venueId: "venue-test",
            condition: "warm",
            reason: "Nice.",
            contributorHandle: "night_owl",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          post({
            venueId: "venue-missing",
            condition: "warm",
            reason: "The garden keeps the evening light.",
            contributorHandle: "night_owl",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("answers 503 when venue membership cannot be checked", async () => {
    venueState.unavailable = true;
    const response = await POST(
      post({
        venueId: "venue-test",
        condition: "warm",
        reason: "The garden keeps the evening light.",
        contributorHandle: "night_owl",
      }),
    );
    expect(response.status).toBe(503);
  });

  it("rate-limits one device churning recommendations at one pub", async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await POST(
        post({
          venueId: "venue-test",
          condition: "warm",
          reason: `The garden is worth choosing, version ${index}.`,
          contributorHandle: "night_owl",
        }),
      );
      expect(response.status, `write ${index + 1}`).toBe(index < 5 ? 201 : 429);
    }
  });
});

describe("GET /api/weather-recommendations", () => {
  async function seed(
    condition: "warm" | "clear" | "raining" | "cold" | "windy",
    contributorHandle: string,
    now: number,
    reason = `A useful ${condition} reason for this pub.`,
  ) {
    await memoryWeatherRecommendationStore.create(
      {
        venueId: "venue-test",
        condition,
        reason,
        contributorHandle,
        actorHash: `actor-${contributorHandle}`,
      },
      now,
    );
  }

  it("surfaces only recommendations matching known current conditions", async () => {
    await seed("cold", "cold_friend", 1_000);
    await seed("warm", "warm_friend", 2_000);
    await seed("clear", "clear_friend", 3_000);

    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      weatherStatus: "available",
      matchingConditions: ["warm", "clear"],
      recommendations: [
        expect.objectContaining({
          condition: "clear",
          contributorHandle: "clear_friend",
        }),
        expect.objectContaining({
          condition: "warm",
          contributorHandle: "warm_friend",
        }),
      ],
      degraded: false,
      truncated: false,
    });
  });

  it("shows authored recommendations unconditionally when weather is unavailable", async () => {
    await seed("cold", "cold_friend", 1_000);
    await seed("warm", "warm_friend", 2_000);
    weatherState.snapshot = null;

    const response = await GET(get());
    expect(await response.json()).toEqual({
      weatherStatus: "unavailable",
      matchingConditions: [],
      recommendations: [
        expect.objectContaining({ condition: "warm" }),
        expect.objectContaining({ condition: "cold" }),
      ],
      degraded: false,
      truncated: false,
    });
  });

  it("returns known weather with no matching opinion as an empty matched read", async () => {
    await seed("cold", "cold_friend", 1_000);

    const response = await GET(get());
    expect(await response.json()).toMatchObject({
      weatherStatus: "available",
      matchingConditions: ["warm", "clear"],
      recommendations: [],
    });
  });

  it("keeps a maximum unavailable-weather response inside the live payload budget", async () => {
    weatherState.snapshot = null;
    for (let index = 0; index < 20; index += 1) {
      await seed(
        "warm",
        `person_${String(index).padStart(2, "0")}_${"x".repeat(18)}`,
        index,
        "R".repeat(160),
      );
    }

    const response = await GET(get());
    const raw = await response.text();
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(
      WEATHER_RECOMMENDATION_RESPONSE_BUDGET_BYTES,
    );
    expect(raw).not.toContain("actor-");
  });
});
