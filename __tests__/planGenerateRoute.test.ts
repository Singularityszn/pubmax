import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listedBundleFixture = vi.hoisted(() => ({
  rows: null as import("@/lib/ukPriceBundle").UkPriceBundleRow[] | null,
  status: "ready" as "ready" | "empty" | "unavailable",
  indexCoverage: null as { truncated: boolean; degraded: boolean } | null,
}));
vi.mock("@/lib/ukPriceBundle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ukPriceBundle.server")>();
  const { listedCategoryPrices } = await import("@/lib/listedCategoryPrices");
  return {
    ...actual,
    ukPriceBundleRowsFor: async (venueId: string) => listedBundleFixture.rows === null
      ? actual.ukPriceBundleRowsFor(venueId)
      : { status: listedBundleFixture.status, rows: listedBundleFixture.rows.filter((row) => row.venueId === venueId) },
    ukPriceBundleCategoryIndex: async (category: import("@/lib/drinks").DrinkCategory, now: number) => {
      if (listedBundleFixture.rows === null) return actual.ukPriceBundleCategoryIndex(category, now);
      const prices = [...new Set(listedBundleFixture.rows.map((row) => row.venueId))].flatMap((venueId) => {
        const quote = listedCategoryPrices(listedBundleFixture.rows!.filter((row) => row.venueId === venueId), now)
          .find((value) => value.category === category);
        return quote ? [{ venueId, ...quote }] : [];
      });
      return {
        prices,
        ...(listedBundleFixture.indexCoverage ?? {
          truncated: false,
          degraded: listedBundleFixture.status === "unavailable",
        }),
      };
    },
  };
});


const { isLimitedMock, loadConciergeVenuesMock, categoryIndexMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async (...args: [
    localKey: string,
    durableKey: string,
    limit?: number,
    windowMs?: number,
    opts?: { failClosed?: boolean },
  ]) => {
    void args;
    return false;
  }),
  loadConciergeVenuesMock: vi.fn(),
  categoryIndexMock: vi.fn(),
}));

const { fetchWalkLegRouteMock, orsApiKeyMock, walkRouteStoreMock } = vi.hoisted(() => ({
  fetchWalkLegRouteMock: vi.fn(),
  orsApiKeyMock: vi.fn<() => string | null>(() => null),
  walkRouteStoreMock: {
    getLeg: vi.fn(async () => null),
    putLeg: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// Hermetic weather: the live refresh workflow rewrites the shipped snapshot
// (0 or 20 observations depending on the day), which would flip the "does not
// invent weather" assertion below. Pin an empty snapshot so this file never
// depends on whatever the cron last wrote. The only weather assertion wants null.
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/concierge/venues.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/concierge/venues.server")>();
  loadConciergeVenuesMock.mockImplementation(actual.loadConciergeVenues);
  return { ...actual, loadConciergeVenues: loadConciergeVenuesMock };
});
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  categoryIndexMock.mockImplementation(actual.readCommunityPriceCategoryIndex);
  return { ...actual, readCommunityPriceCategoryIndex: categoryIndexMock };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: fetchWalkLegRouteMock,
  orsApiKey: orsApiKeyMock,
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => walkRouteStoreMock,
}));

import { GET, POST } from "@/app/api/plans/generate/route";
import { preparePlanGeneration } from "@/lib/planGeneration.server";
import { verifyAnchoredPlanGroundingProofV2, verifyPlanGroundingProof } from "@/lib/planGrounding.server";
import * as routeEvidence from "@/lib/planRouteEvidence.server";
import * as anchorResolution from "@/lib/planningAnchor.server";
import { buildPriceEvidence } from "@/lib/planRouteEvidence";
import { validateNightSignalClaim, type NightSignalClaim } from "@/lib/nightSignalClaims";
import nightSignalSnapshot from "@/public/data/night_signals/latest.json";
import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendBudgetKey,
} from "@/lib/paidSpendBudget";
import { hashIp } from "@/lib/supabase";
import type { LngLat } from "@/lib/walkRoute";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { PlanIntakeHandoff } from "@/lib/planIntake";

const PLAN_GENERATION_TEST_NOW = PINT_DATASET_OBSERVED_AT.getTime() + 1_000;

function generationIntake(
  overrides: Partial<PlanIntakeHandoff> = {},
): PlanIntakeHandoff {
  return {
    version: 1,
    area: { kind: "night-patch", id: "clapham" },
    timeWindow: null,
    groupSize: 4,
    budget: { tier: "standard", limitPence: null },
    accessibilityNeeds: [],
    skipped: ["time-window"],
    ...overrides,
  };
}

function generatedVenue(
  id: string,
  options: Partial<ConciergeVenue> = {},
): ConciergeVenue {
  const index = Number(id.replace(/\D/g, "")) || 0;
  return {
    id,
    name: `Venue ${id}`,
    area: "Lambeth",
    lat: 51.462 + index * 0.001,
    lng: -0.138 + index * 0.001,
    cheapestPrice: 5,
    amenities: {
      beerGarden: false,
      cocktails: false,
      food: false,
      liveSports: false,
      liveMusic: false,
    },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...options,
  };
}

async function prepareWineValueSearch(now: number) {
  // Price validation uses the real quote reader and its own clock. Keep that
  // clock at daytime so the injected night clock remains independently tested.
  const daytime = new Date(now);
  daytime.setUTCHours(12, 0, 0, 0);
  const clockNow = daytime.getTime();
  const clock = vi.spyOn(Date, "now").mockReturnValue(clockNow);
  const observedAt = new Date(Math.min(now, clockNow) - 1_000).toISOString();
  const previousRows = listedBundleFixture.rows;
  const previousStatus = listedBundleFixture.status;
  const previousCoverage = listedBundleFixture.indexCoverage;
  const resolution = vi.spyOn(anchorResolution, "resolvePlanningAnchor").mockResolvedValue({
    status: "resolved",
    display: { venueId: "v1", venueName: "Venue v1", areaName: "Clapham", startLabel: null,
      priceEvidence: null, routeWindowOk: true, budgetCompatible: true, accessibilityCompatible: true },
    canonical: { cityId: "london", venueId: "v1", nightAreaSlug: "clapham",
      acceptedArea: { kind: "night-patch", id: "clapham" }, coordinates: { lat: 51.463, lng: -0.137 },
      startsAt: null, priceObservedAt: null, priceFreshnessKind: "unknown" },
  });
  try {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1", { cheapestPrice: 4 }),
      generatedVenue("v2", { cheapestPrice: 6 }),
      generatedVenue("v3", { cheapestPrice: 3 }),
    ]);
    categoryIndexMock.mockResolvedValueOnce({
      prices: [
        { venueId: "v1", drinkCategory: "wine", priceGbp: 9, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v2", drinkCategory: "wine", priceGbp: 7, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v3", drinkCategory: "wine", priceGbp: 5, submittedAt: now, source: "community", corroborations: 1 },
      ],
      truncated: false,
      degraded: false,
    });
    listedBundleFixture.rows = [["v1", 9], ["v2", 7]].map(([venueId, priceGbp]) => ({
      venueId: String(venueId), name: `Venue ${venueId}`, category: "wine", priceGbp: Number(priceGbp),
      drinkLabel: `Named wine ${venueId}`, servingSize: "125ml", lane: "site-harvest", standing: "listed",
      sourceUrl: `https://pub.example/${venueId}/wine`, observedAt, publisher: "Fixture publisher", basis: null, sampleSize: null,
    }));
    listedBundleFixture.status = "ready";
    listedBundleFixture.indexCoverage = null;
    return await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "cheap 125ml wine in Clapham for 2",
        anchor: { venueId: "v1", source: "pal", acceptedArea: { kind: "night-patch", id: "clapham" }, startsAt: null,
          selectedDrinkPriceEvidence: { category: "wine", pence: 900, serving: "125ml", source: "listed",
            sourceUrl: "https://pub.example/v1/wine", observedAt } },
      }),
    }), now);
  } finally {
    listedBundleFixture.rows = previousRows;
    listedBundleFixture.status = previousStatus;
    listedBundleFixture.indexCoverage = previousCoverage;
    resolution.mockRestore();
    clock.mockRestore();
  }
}

describe("POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockClear();
    categoryIndexMock.mockClear();
    fetchWalkLegRouteMock.mockReset();
    fetchWalkLegRouteMock.mockResolvedValue(null);
    orsApiKeyMock.mockReset();
    orsApiKeyMock.mockReturnValue(null);
    walkRouteStoreMock.getLeg.mockReset();
    walkRouteStoreMock.getLeg.mockResolvedValue(null);
    walkRouteStoreMock.putLeg.mockReset();
    walkRouteStoreMock.putLeg.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.RATE_LIMIT_SALT;
  });

  it("warms stable planning data without creating a plan", async () => {
    const response = await GET(new Request("http://localhost/api/plans/generate?cityId=london"));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
    expect(isLimitedMock).not.toHaveBeenCalled();
  });

  it("returns an explained three-stop suggestion without creating a Plan", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.grounded).toBe(true);
    expect(body.inferredContext).toMatchObject({ nightArea: "clapham", daypart: "after_work", groupSize: 4 });
    expect(body.stops).toHaveLength(3);
    expect(verifyPlanGroundingProof(
      body.groundingProof,
      body.stops.map((stop: { venueId: string }) => stop.venueId),
      body.operationKey,
    )).toBe(true);
    expect(body.stops[0]).toMatchObject({
      venueId: expect.any(String),
      venueName: expect.any(String),
      reason: expect.any(String),
      provenance: expect.arrayContaining([expect.objectContaining({ kind: "venue_dataset" })]),
      alternatives: expect.arrayContaining([expect.objectContaining({
        venueId: expect.any(String),
        distanceKm: expect.any(Number),
        provenance: expect.any(Array),
      })]),
    });
    expect(body.routeTotals).toMatchObject({
      stopCount: 3,
      straightLineWalkingKm: expect.any(Number),
      estimatedWalkingMinutes: expect.any(Number),
      distanceBasis: "straight-line",
    });
    expect(body.stops.map((stop: { walkingMinutesFromPrevious: number | null }) => stop.walkingMinutesFromPrevious))
      .toEqual([null, expect.any(Number), expect.any(Number)]);
    expect(fetchWalkLegRouteMock).not.toHaveBeenCalled();
    expect(body.endingRecommendations).toEqual([
      expect.objectContaining({ kind: "food", requiresConfirmation: true }),
      expect.objectContaining({ kind: "get_home", requiresConfirmation: true }),
      expect.objectContaining({ kind: "keep_going", requiresConfirmation: true }),
    ]);
    expect(body.endingRecommendations[2].options).toContainEqual(expect.objectContaining({
      priceImpactPence: expect.any(Number),
      detail: expect.stringContaining("recorded pint"),
    }));
    expect(body.contextEffects).toEqual(expect.arrayContaining(["budget", "daypart", "groupSize", "atmosphere"]));
    expect(body.contextEffects).not.toContain("drinkCategory");
    expect(body.missingContextEvidence).toEqual([]);
    expect(body.explanations).toEqual(expect.arrayContaining([expect.objectContaining({ field: "nightArea" })]));
    expect(body).not.toHaveProperty("planId");
  });

  it("delivers source-stated listed wine to generated stops and alternatives when community reads are unavailable", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    const observedAt = new Date(PLAN_GENERATION_TEST_NOW - 1_000).toISOString();
    loadConciergeVenuesMock.mockResolvedValueOnce(["v1", "v2", "v3", "v4"].map((id) => generatedVenue(id)));
    categoryIndexMock.mockResolvedValueOnce({ prices: [], truncated: false, degraded: true });
    listedBundleFixture.rows = ["v1", "v2", "v3", "v4"].map((venueId, index) => ({
      venueId, name: `Venue ${venueId}`, category: "wine", priceGbp: 5.25 + index,
      drinkLabel: `Named wine ${index}`, servingSize: "125ml", lane: "site-harvest", standing: "listed",
      sourceUrl: `https://pub.example/${venueId}/menu`, observedAt, publisher: "Fixture publisher", basis: null, sampleSize: null,
    }));
    listedBundleFixture.status = "ready";
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify({ query: "cheap wine in Clapham for 2" }),
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.inferredContext.drinkCategory).toBe("wine");
      expect(body.stops).toHaveLength(3);
      const delivered = [...body.stops, ...body.stops.flatMap((stop: { alternatives: unknown[] }) => stop.alternatives)];
      expect(delivered.some((stop) => stop.venueId === "v4")).toBe(true);
      for (const stop of delivered) {
        const row = listedBundleFixture.rows.find((value) => value.venueId === stop.venueId)!;
        expect(row).toBeDefined();
        expect(stop).toMatchObject({ estimatedPintPricePence: null, priceEvidence: null,
          selectedDrinkPriceEvidence: { category: "wine", pence: Math.round(row.priceGbp * 100),
            serving: "125ml", source: "listed", sourceUrl: row.sourceUrl, observedAt } });
      }
      expect(verifyPlanGroundingProof(body.groundingProof, body.stops.map((stop: { venueId: string }) => stop.venueId), body.operationKey)).toBe(true);
    } finally {
      clock.mockRestore();
      listedBundleFixture.rows = null;
    }
  });

  it("retains trusted wine attribution without amount-ranking unknown servings or borrowing pint prices", async () => {
    const venues = [
      generatedVenue("v1", { cheapestPrice: 4 }),
      generatedVenue("v2", { cheapestPrice: 6 }),
      generatedVenue("v3", { cheapestPrice: 3 }),
    ];
    const now = PLAN_GENERATION_TEST_NOW;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const previousListedRows = listedBundleFixture.rows;
    listedBundleFixture.rows = [];
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "cheap wine in Clapham for 2" }),
    });
    const seedReads = (firstAmount: number, secondAmount: number) => {
      loadConciergeVenuesMock.mockResolvedValueOnce(venues);
      categoryIndexMock.mockResolvedValueOnce({
        prices: [
          { venueId: "v1", drinkCategory: "wine", priceGbp: firstAmount, submittedAt: now, source: "community", corroborations: 2 },
          { venueId: "v2", drinkCategory: "wine", priceGbp: secondAmount, submittedAt: now, source: "community", corroborations: 2 },
          { venueId: "v3", drinkCategory: "wine", priceGbp: 5, submittedAt: now, source: "community", corroborations: 1 },
        ],
        truncated: false,
        degraded: false,
      });
    };
    try {
      seedReads(9, 7);
      const original = await preparePlanGeneration(request());
      expect("prepared" in original).toBe(true);
      if (!("prepared" in original)) return;
      expect(categoryIndexMock).toHaveBeenCalledWith(expect.arrayContaining(["wine"]), now);
      expect(original.prepared.context.drinkCategory).toBe("wine");
      const originalRank = original.prepared.candidates.map(({ venue, score }) => ({ id: venue.id, score }));
      for (const [id, priceGbp] of [["v1", 9], ["v2", 7]] as const) {
        const candidate = original.prepared.candidates.find(({ venue }) => venue.id === id)!;
        expect(candidate.selectedDrinkPrice).toMatchObject({ category: "wine", priceGbp, source: "community", submittedAt: now });
        expect(candidate.selectedDrinkPrice?.servingSize ?? null).toBeNull();
        expect(candidate.reasons.join(" ")).not.toMatch(/pints from|wine price £/i);
      }
      expect(original.prepared.candidates.find(({ venue }) => venue.id === "v3")?.selectedDrinkPrice).toBeNull();

      // Reverse the cheaper report decisively. Unknown servings carry
      // attribution, never a raw-GBP comparison or a score bonus.
      seedReads(2, 20);
      const changed = await preparePlanGeneration(request());
      expect("prepared" in changed).toBe(true);
      if (!("prepared" in changed)) return;
      expect(changed.prepared.candidates.map(({ venue, score }) => ({ id: venue.id, score }))).toEqual(originalRank);
      expect(changed.prepared.candidates.find(({ venue }) => venue.id === "v1")?.selectedDrinkPrice?.priceGbp).toBe(2);
      expect(changed.prepared.candidates.find(({ venue }) => venue.id === "v2")?.selectedDrinkPrice?.priceGbp).toBe(20);
      expect(changed.prepared.candidates.find(({ venue }) => venue.id === "v3")?.selectedDrinkPrice).toBeNull();

      seedReads(9, 7);
      const response = await POST(request());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.stops.map((stop: { venueId: string }) => stop.venueId).sort()).toEqual(["v1", "v2", "v3"]);
      expect(body.budgetSummary).toMatchObject({ estimatedPerPersonPence: null, estimatedCrewPence: null,
        basis: "selected-drink-price-unavailable" });
      for (const [id, pence] of [["v1", 900], ["v2", 700]] as const) {
        expect(body.stops.find((stop: { venueId: string }) => stop.venueId === id)).toMatchObject({
          estimatedPintPricePence: null, priceEvidence: null,
          selectedDrinkPriceEvidence: { category: "wine", pence, serving: null,
            source: "community", reportedAt: new Date(now).toISOString() },
        });
      }
      expect(body.stops.find((stop: { venueId: string }) => stop.venueId === "v3")?.selectedDrinkPriceEvidence ?? null).toBeNull();
    } finally {
      listedBundleFixture.rows = previousListedRows;
      clock.mockRestore();
    }
  });

  it("joins trusted wine prices into value ranking without using pint prices", async () => {
    // The dataset stamp is 13:00 London, so the distance weight is two and
    // the cheaper comparable glass leads.
    const result = await prepareWineValueSearch(PLAN_GENERATION_TEST_NOW);

    expect("prepared" in result).toBe(true);
    if (!("prepared" in result)) return;
    expect(result.prepared.context.daypart).toBe("daytime");
    expect(categoryIndexMock).toHaveBeenCalledWith(expect.arrayContaining(["wine"]), PLAN_GENERATION_TEST_NOW);
    expect(result.prepared.candidates.map((candidate) => candidate.venue.id)).toEqual(["v2", "v1", "v3"]);
    expect(result.prepared.candidates[0]?.reasons).toContain("listed 125ml wine price £7.00");
    expect(result.prepared.candidates[0]?.reasons.join(" ")).not.toMatch(/pints from/i);
    expect(result.prepared.candidates[2]?.reasons.join(" ")).not.toMatch(/pints|£/i);
  });

  it("ranks the nearer dearer wine first after 23:00 London", async () => {
    // 23:30 London is get_home. The distance weight is three, so v1's shorter
    // walk outranks v2's cheaper glass. v3 still has only one corroboration.
    const lateNight = Date.parse("2026-07-16T22:30:00.000Z");
    const result = await prepareWineValueSearch(lateNight);

    expect("prepared" in result).toBe(true);
    if (!("prepared" in result)) return;
    expect(result.prepared.context.daypart).toBe("get_home");
    expect(result.prepared.candidates.map((candidate) => candidate.venue.id)).toEqual(["v1", "v2", "v3"]);
    expect(result.prepared.candidates[0]?.reasons).toContain("listed 125ml wine price £9.00");
    expect(result.prepared.candidates[0]?.reasons.join(" ")).not.toMatch(/pints from/i);
    expect(result.prepared.candidates[2]?.reasons.join(" ")).not.toMatch(/pints|£/i);
  });

  it("ranks the nearer dearer wine first in the London small hours", async () => {
    // 02:30 London is still last night's late_night, with the same distance weight.
    const smallHours = Date.parse("2026-07-17T01:30:00.000Z");
    const result = await prepareWineValueSearch(smallHours);

    expect("prepared" in result).toBe(true);
    if (!("prepared" in result)) return;
    expect(result.prepared.context.daypart).toBe("late_night");
    expect(result.prepared.candidates.map((candidate) => candidate.venue.id)).toEqual(["v1", "v2", "v3"]);
    expect(result.prepared.candidates[0]?.reasons).toContain("listed 125ml wine price £9.00");
  });

  it("carries trusted wine price evidence to selected stops and alternatives without inventing a serving", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1", { cheapestPrice: 4 }),
      generatedVenue("v2", { cheapestPrice: 6 }),
      generatedVenue("v3", { cheapestPrice: 3 }),
      generatedVenue("v4", { cheapestPrice: 5 }),
    ]);
    const now = Date.now();
    categoryIndexMock.mockResolvedValueOnce({
      prices: [
        { venueId: "v1", drinkCategory: "wine", priceGbp: 9, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v2", drinkCategory: "wine", priceGbp: 7, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v3", drinkCategory: "wine", priceGbp: 5, submittedAt: now, source: "community", corroborations: 1 },
      ],
      truncated: false,
      degraded: false,
    });

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "cheap wine in Clapham for 2" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.contextEffects).toContain("drinkCategory");
    const pricedStop = body.stops.find((stop: { venueId: string }) => stop.venueId === "v2");
    expect(pricedStop).toMatchObject({
      estimatedPintPricePence: null,
      priceEvidence: null,
      selectedDrinkPriceEvidence: {
        category: "wine",
        pence: 700,
        serving: null,
        source: "community",
        reportedAt: new Date(now).toISOString(),
      },
    });
    const untrusted = body.stops.find((stop: { venueId: string }) => stop.venueId === "v3");
    expect(untrusted).toBeDefined();
    expect(untrusted?.selectedDrinkPriceEvidence ?? null).toBeNull();
    const unpricedAlternative = body.stops.flatMap((stop: { alternatives: Array<{ venueId: string }> }) => stop.alternatives)
      .find((stop: { venueId: string }) => stop.venueId === "v4");
    expect(unpricedAlternative).toBeDefined();
    expect(unpricedAlternative?.selectedDrinkPriceEvidence ?? null).toBeNull();
  });

  it.each([
    ["cheap wine in Clapham for 2", "wine"],
    ["cheap cocktails in Clapham for 2", "cocktail"],
    ["cheap whisky in Clapham for 2", "whisky"],
    ["cheap alcohol-free drinks in Clapham for 2", null],
  ])("keeps pint prices out of generated %s response", async (query, drinkCategory) => {
    categoryIndexMock.mockResolvedValueOnce({ prices: [], truncated: false, degraded: false });
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext.drinkCategory ?? null).toBe(drinkCategory);
    expect(body.stops).toHaveLength(3);
    expect(body.stops.every((stop: { estimatedPintPricePence: number | null; priceEvidence: unknown }) =>
      stop.estimatedPintPricePence === null && stop.priceEvidence === null)).toBe(true);
    expect(body.budgetSummary).toMatchObject({
      estimatedPerPersonPence: null,
      withinLimit: null,
      basis: "selected-drink-price-unavailable",
    });
    const extensions = body.endingRecommendations.find((ending: { kind: string }) => ending.kind === "keep_going")?.options;
    expect(extensions.length).toBeGreaterThan(0);
    expect(extensions.every((option: { detail: string; priceImpactPence: number | null }) =>
      option.priceImpactPence === null && option.detail.includes("drink price unavailable for this extension") && !option.detail.includes("pint"))).toBe(true);
    expect(body.missingContextEvidence).toContain("price_evidence");
  });

  it.each([
    ["degraded", false, true, "We could not read the wine prices from every source just now. Any prices shown come from sources we could read."],
    ["partial", true, false, "Read from part of the wine prices, so some are still missing."],
  ])("discloses %s wine price index coverage in plan confidence", async (_status, truncated, degraded, warning) => {
    categoryIndexMock.mockResolvedValueOnce({ prices: [], truncated, degraded });
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "cheap wine in Clapham for 2" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.planningConfidence.warnings).toContain(warning);
    expect(body.planningConfidence.level).not.toBe("high");
  });

  it.each([
    ["degraded", { truncated: false, degraded: true }, "We could not read the wine prices from every source just now. Any prices shown come from sources we could read."],
    ["truncated", { truncated: true, degraded: false }, "Read from part of the wine prices, so some are still missing."],
  ])("discloses %s listed wine index coverage when community index is ready", async (_status, listedCoverage, warning) => {
    categoryIndexMock.mockResolvedValueOnce({ prices: [], truncated: false, degraded: false });
    listedBundleFixture.rows = [];
    listedBundleFixture.status = "ready";
    listedBundleFixture.indexCoverage = listedCoverage;
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "cheap wine in Clapham for 2" }),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.inferredContext.drinkCategory).toBe("wine");
      expect(categoryIndexMock).toHaveBeenCalledWith(expect.arrayContaining(["wine"]), expect.any(Number));
      expect(body.planningConfidence.warnings).toContain(warning);
      expect(body.planningConfidence.level).not.toBe("high");
    } finally {
      listedBundleFixture.rows = null;
      listedBundleFixture.indexCoverage = null;
    }
  });

  it.each([5, 6])("returns a grounded %i-stop route from free text", async (stopCount) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: `a ${stopCount} pub crawl in Clapham` }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext.stopCount).toBe(stopCount);
    expect(body.stops).toHaveLength(stopCount);
    expect(new Set(body.stops.map((stop: { venueId: string }) => stop.venueId)).size).toBe(stopCount);
    expect(body.routeTotals).toMatchObject({ stopCount });
    expect(verifyPlanGroundingProof(
      body.groundingProof,
      body.stops.map((stop: { venueId: string }) => stop.venueId),
      body.operationKey,
    )).toBe(true);
    expect(body.stops.map((stop: { walkingMinutesFromPrevious: number | null }) => stop.walkingMinutesFromPrevious))
      .toEqual([null, ...Array.from({ length: stopCount - 1 }, () => expect.any(Number))]);
  });

  // F-13: with a stopCount of 1 or 2 the candidate set can be 1 or 2 ids, and
  // the grounding proof's own floor was still a literal 3, so the mint threw a
  // plain Error the route re-threw as a 500 - the one answer a planner surface
  // cannot word. Both counts now mint like any other plan, and a set the server
  // still cannot prove takes the scarcity 422 beside it.
  it.each([1, 2])("returns a grounded %i-stop route rather than a 500", async (stopCount) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: `a ${stopCount} pub crawl in Clapham` }),
    }));
    const body = await response.json();

    expect(response.status).not.toBe(500);
    expect(response.status).toBe(200);
    expect(body.inferredContext.stopCount).toBe(stopCount);
    expect(body.stops).toHaveLength(stopCount);
    expect(verifyPlanGroundingProof(
      body.groundingProof,
      body.stops.map((stop: { venueId: string }) => stop.venueId),
      body.operationKey,
    )).toBe(true);
  });

  it("returns an actionable retry response when trusted proof signing is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
    delete process.env.RATE_LIMIT_SALT;

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "Plan saving is temporarily unavailable. Try again.",
      code: "PLAN_SIGNING_UNAVAILABLE",
      retryable: true,
    });
    expect(isLimitedMock).not.toHaveBeenCalled();
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it("requires a description or explicit Night Context", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", { method: "POST", body: "{}" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.any(String),
      code: "NIGHT_CONTEXT_REQUIRED",
      retryable: false,
    });
  });

	it("rejects oversized bodies with the public API envelope before rate limiting", async () => {
		const response = await POST(new Request("http://localhost/api/plans/generate", {
			method: "POST",
			body: JSON.stringify({ query: "x".repeat(17_000) }),
		}));
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: "Request body is too large.",
			code: "REQUEST_TOO_LARGE",
			retryable: false,
		});
		expect(isLimitedMock).not.toHaveBeenCalled();
	});

  it("uses the same privacy-safe per-client bucket for local and durable limiting", async () => {
    // The LEFT-MOST entry is the one a caller always writes, so it names
    // nobody; the right-most entry is what the nearest hop appended
    // (lib/clientIpTrust.ts owns that rule).
    const spoofedIp = "203.0.113.42";
    const trustedIp = "198.51.100.7";
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-forwarded-for": `${spoofedIp}, ${trustedIp}` },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(response.status).toBe(200);
    const expectedKey = `plan-generate:${hashIp(trustedIp)}`;
    expect(isLimitedMock.mock.calls[0]).toEqual([expectedKey, expectedKey, 8, 60_000]);
    const recorded = JSON.stringify(isLimitedMock.mock.calls);
    expect(recorded).not.toContain(spoofedIp);
    expect(recorded).not.toContain(trustedIp);
    expect(recorded).not.toContain(hashIp(spoofedIp));
  });

  it("spends the deployment ceiling as well, on a key no header can widen", async () => {
    await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.42" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    const budgetCall = isLimitedMock.mock.calls.find(
      (call) => call[0] === paidSpendBudgetKey("plan-generate"),
    );
    expect(budgetCall).toBeDefined();
    expect(budgetCall?.[1]).toBe(paidSpendBudgetKey("plan-generate"));
    expect(budgetCall?.[3]).toBe(PAID_SPEND_BUDGET_WINDOW_MS);
    expect(budgetCall?.[4]).toEqual({ failClosed: true });
  });

  it("refuses with the deployment ceiling's own sentence once it is spent", async () => {
    isLimitedMock.mockImplementation(async (key: string) =>
      key === paidSpendBudgetKey("plan-generate"),
    );

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.42" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: PAID_SPEND_REFUSAL_LINE,
      code: PAID_SPEND_REFUSAL_CODE,
      retryable: true,
    });
  });

  it("enforces rate limiting inside request preparation", async () => {
    isLimitedMock.mockResolvedValueOnce(true);

    const preparation = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(isLimitedMock).toHaveBeenCalledOnce();
    expect("response" in preparation ? preparation.response.status : null).toBe(429);
  });

  it("isolates plan-generation budgets by client and preserves the flat 429 contract", async () => {
    for (const rawIp of ["203.0.113.1", "203.0.113.2"]) {
      await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "x-real-ip": rawIp },
        body: JSON.stringify({ query: "A quiet night in Barnes" }),
      }));
    }
    // Each request spends TWO budgets: its own address bucket, then the
    // deployment ceiling. The per-address buckets differ; the ceiling does not.
    const perClientKeys = isLimitedMock.mock.calls
      .map((call) => call[0] as string)
      .filter((key) => key.startsWith("plan-generate:"));
    expect(perClientKeys).toHaveLength(2);
    expect(perClientKeys[0]).not.toBe(perClientKeys[1]);

    isLimitedMock.mockResolvedValueOnce(true);
    const limited = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.3" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "Too many requests.",
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("shares one bucket for repeated requests from the same client", async () => {
    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "x-real-ip": "203.0.113.9" },
        body: JSON.stringify({ query: "A quiet night in Barnes" }),
      }));
    }
    const perClientCalls = isLimitedMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("plan-generate:"),
    );
    expect(perClientCalls).toHaveLength(2);
    expect(perClientCalls[0]?.slice(0, 2)).toEqual(perClientCalls[1]?.slice(0, 2));
  });

  it("does not load venues after rate-limit rejection", async () => {
    isLimitedMock.mockResolvedValueOnce(true);
    const before = loadConciergeVenuesMock.mock.calls.length;
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-real-ip": "203.0.113.10" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));
    expect(response.status).toBe(429);
    expect(loadConciergeVenuesMock).toHaveBeenCalledTimes(before);
  });

  it("keeps inferred brief fields when the client sends only explicit chip corrections", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({
          query: "A quiet night in Barnes under £24 each",
          context: { groupSize: 4 },
        }),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.inferredContext).toMatchObject({
        nightArea: "barnes",
        atmosphere: ["quiet"],
        budgetLimitPence: 2400,
        groupSize: 4,
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("retains partial soft list-based context corrections", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "An evening in Clapham",
        context: {
          atmosphere: ["historic"],
          foodNeeds: ["kebab"],
        },
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({
      atmosphere: ["historic"],
      foodNeeds: ["kebab"],
    });
    expect(body.contextEffects).toEqual(expect.arrayContaining(["atmosphere", "foodNeeds"]));
    expect(body.missingContextEvidence).toContain("food_terminal_specificity");
  });

  it("records wetherspoonsPreferred in contextEffects without hard-filtering the route", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "chill Wetherspoons in Clapham for 3" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({
      nightArea: "clapham",
      daypart: "daytime",
      groupSize: 3,
      budget: "value",
      wetherspoonsPreferred: true,
    });
    expect(body.contextEffects).toEqual(expect.arrayContaining(["wetherspoonsPreferred", "budget", "daypart"]));
    expect(body.stops).toHaveLength(3);
  });

  it("always returns an editable route with honest confidence for a reviewed area", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      planningConfidence: {
        level: "low",
        routeReady: false,
        missingEvidence: expect.arrayContaining(["opening_hours"]),
        warnings: expect.any(Array),
      },
      nightArea: {
        id: "barnes",
        coverageStatus: "reviewed",
        coverageScore: expect.any(Number),
        missingEvidence: expect.arrayContaining(["opening_hours"]),
        routeReady: false,
        lastReviewedAt: expect.any(String),
      },
    });
    expect(body.district).toMatchObject(body.nightArea);
    expect(body.stops).toHaveLength(3);
  });

  it("does not invent weather when the scheduled cache has no active observation", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "A beer garden night in Clapham" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.weatherEvidence).toBeNull();
    expect(body.planningConfidence.missingEvidence).toContain("live_weather");
    expect(body.contextEffects).not.toContain("weather");
  });

  it("returns route budget evidence while preserving the legacy numeric confidence", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Four of us in Clapham, under £24 each" }),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.confidence).toEqual(expect.any(Number));
      expect(body.budgetSummary).toMatchObject({
        currency: "GBP",
        limitPence: 2400,
        estimatedPerPersonPence: expect.any(Number),
        estimatedCrewPence: expect.any(Number),
        withinLimit: expect.any(Boolean),
      });
      expect(body.stops[0]).toMatchObject({
        estimatedPintPricePence: expect.any(Number),
        distanceKm: expect.any(Number),
        evidence: expect.any(Array),
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("does not satisfy a wine ceiling with pint prices", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Cheap wine in Clapham for four, under £24 each" }),
      }));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toMatchObject({
        code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
        details: { rejected: { budgetEvidence: expect.any(Number) } },
      });
      expect(body.details.rejected.budgetEvidence).toBeGreaterThan(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("fails an alcohol-free ceiling closed rather than pricing it with pints", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const pints = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Four of us in Clapham, under £24 each" }),
      }));
      expect(pints.status).toBe(200);
      expect((await pints.json()).budgetSummary).toMatchObject({ limitPence: 2400, withinLimit: true });

      const alcoholFree = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Four of us in Clapham, alcohol-free, under £24 each" }),
      }));
      expect(alcoholFree.status).toBe(422);
      const body = await alcoholFree.json();
      expect(body).toMatchObject({
        code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
        details: { rejected: { budgetEvidence: expect.any(Number), budgetCeiling: 0 } },
      });
      expect(body.details.rejected.budgetEvidence).toBeGreaterThan(0);
    } finally {
      clock.mockRestore();
    }
  });

  it("discloses missing selected-drink evidence on a value wine route", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Cheap wine in Clapham for four",
        intake: generationIntake({ budget: { tier: "value", limitPence: null } }),
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.inferredContext.drinkCategory).toBe("wine");
    expect(body.constraintReport.softRelaxations).toContainEqual({
      code: "value_price_evidence_incomplete",
      message: "The value preference was applied, but comparable verified prices for the selected drink are unavailable for the selected stops.",
    });
    expect(body.stops.every((stop: { estimatedPintPricePence: number | null }) => stop.estimatedPintPricePence === null)).toBe(true);
  });

  it("uses ORS leg durations for per-stop and route walking minutes when keyed", async () => {
    const durations = [125, 240];
    orsApiKeyMock.mockReturnValue("ork_secret");
    fetchWalkLegRouteMock.mockImplementation(async (from: LngLat, to: LngLat) => ({
      coordinates: [from, to],
      durationSeconds: durations.shift() ?? null,
    }));

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routeTotals).toMatchObject({
      stopCount: 3,
      estimatedWalkingMinutes: 7,
      distanceBasis: "routed",
    });
    expect(body.stops.map((stop: { walkingMinutesFromPrevious: number | null }) => stop.walkingMinutesFromPrevious))
      .toEqual([null, 3, 4]);
    expect(walkRouteStoreMock.getLeg).toHaveBeenCalledTimes(2);
    expect(walkRouteStoreMock.putLeg).toHaveBeenCalledTimes(2);
  });

  it("still returns 200 and straight-line walking estimates when routing returns null", async () => {
    orsApiKeyMock.mockReturnValue("ork_secret");
    fetchWalkLegRouteMock.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Four of us after work in Clapham, cheap and lively" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.routeTotals.distanceBasis).toBe("straight-line");
    expect(body.routeTotals.estimatedWalkingMinutes).toEqual(expect.any(Number));
    expect(body.stops.map((stop: { walkingMinutesFromPrevious: number | null }) => stop.walkingMinutesFromPrevious))
      .toEqual([null, expect.any(Number), expect.any(Number)]);
    expect(fetchWalkLegRouteMock).toHaveBeenCalledTimes(2);
  });

  it("does not claim a food ending when official evidence is insufficient", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Late night in Clapham with kebab afterwards" }),
    }));
    const body = await response.json();
    const food = body.endingRecommendations.find((ending: { kind: string }) => ending.kind === "food");

    expect(food.preselected).toBe(false);
    expect(food.options).toEqual([]);
    expect(food.warnings).toContain("No late food worth pointing you to round here yet.");
  });

  it("calculates evidenced food distance from the actual final route stop", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-16T23:00:00.000Z"));
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Late night in Soho" }),
      }));
      const body = await response.json();
      const food = body.endingRecommendations.find((ending: { kind: string }) => ending.kind === "food");

      expect(response.status).toBe(200);
      expect(food.options).toEqual([expect.objectContaining({
        label: "Balans No.60",
        detail: expect.stringContaining("direct-distance estimate"),
        provenance: [expect.objectContaining({ label: expect.stringContaining("Balans Restaurants") })],
      })]);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    [null, "PLAN_INTAKE_MALFORMED"],
    [{ ...generationIntake(), version: 2 }, "INTAKE_VERSION_UNSUPPORTED"],
    [{ ...generationIntake(), accessibilityNeeds: ["maybe-step-free"] }, "PLAN_INTAKE_MALFORMED"],
  ])("fails closed when a present intake envelope is malformed", async (intakeValue, code) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Clapham", intake: intakeValue }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code, retryable: false });
		expect(isLimitedMock).not.toHaveBeenCalled();
  });

	it("returns an honest unsupported result for Hackney instead of routing Shoreditch", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "A night in Shoreditch",
        context: { nightArea: "shoreditch" },
        intake: generationIntake({ area: { kind: "night-patch", id: "hackney" } }),
      }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "NIGHT_PATCH_UNSUPPORTED",
      details: { patchId: "hackney" },
	});
	});

	it.each(["soho", "shoreditch", "camden", "london-bridge", "brixton", "clapham", "islington"] as const)(
		"generates for mapped Night Patch %s regardless of readiness metadata",
		async (patchId) => {
			const response = await POST(new Request("http://localhost/api/plans/generate", {
				method: "POST",
				body: JSON.stringify({ intake: generationIntake({ area: { kind: "night-patch", id: patchId } }) }),
			}));
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.stops).toHaveLength(3);
			expect(body.contextFieldSources.nightArea).toBe("intake");
		},
	);

	it("generates a low-confidence route when the mapped patch lacks route-feasibility metadata", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Shoreditch",
        intake: generationIntake({ area: { kind: "night-patch", id: "shoreditch" } }),
      }),
    }));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			inferredContext: { nightArea: "shoreditch" },
			planningConfidence: { level: "low", routeReady: false },
			stops: [{}, {}, {}],
		});
  });

  it("makes the exact intake patch authoritative over conflicting inference", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Shoreditch after work",
        context: { nightArea: "shoreditch" },
        intake: generationIntake(),
      }),
    }));
    const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.inferredContext.nightArea).toBe("clapham");
		expect(body.contextFieldSources.nightArea).toBe("intake");
		expect(body.explanations.filter((reason: { field: string }) => reason.field === "nightArea"))
			.toEqual([expect.objectContaining({ explanation: expect.stringContaining("Plan intake") })]);
    expect(body.constraintReport).toMatchObject({
      version: 1,
      source: "plan-intake-v1",
      hardConstraints: expect.arrayContaining([
        expect.objectContaining({ code: "exact_area", status: "satisfied" }),
        expect.objectContaining({ code: "transport_feasibility", status: "satisfied" }),
      ]),
      softRelaxations: [],
    });
  });

	it("reports end to end that unevidenced group capacity could not shape ranking", async () => {
		const response = await POST(new Request("http://localhost/api/plans/generate", {
			method: "POST",
			body: JSON.stringify({ intake: generationIntake({ groupSize: 8 }) }),
		}));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.constraintReport.softRelaxations).toContainEqual({
			code: "group_fit_unverified",
			message: "Group size did not shape the order because we do not have checked capacity details.",
		});
	});

	it("fails closed when custom candidates cannot be joined to canonical price evidence", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1", { cheapestPrice: 9 }),
      generatedVenue("v2", { cheapestPrice: 6 }),
      generatedVenue("v3", { cheapestPrice: 5 }),
      generatedVenue("v4", { cheapestPrice: 4 }),
      generatedVenue("v5", { cheapestPrice: 3 }),
    ]);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Clapham",
        intake: generationIntake({ budget: { tier: "value", limitPence: 1_200 } }),
      }),
    }));
    const body = await response.json();
		expect(response.status).toBe(422);
		expect(body).toMatchObject({
			code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
			details: { rejected: { budgetEvidence: 5 } },
		});
  });

  it("never returns a stop without confirmed required accessibility", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("accessible-1", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("accessible-2", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("accessible-3", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("accessible-4", { name: "The Ice Wharf - JD Wetherspoon", area: "Camden" }),
      generatedVenue("unknown-5", { name: "Unknown Access", cheapestPrice: 1 }),
    ]);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Clapham",
        intake: generationIntake({ accessibilityNeeds: ["step-free"] }),
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.stops).toHaveLength(3);
    expect(body.stops.every((stop: { venueName: string }) => stop.venueName === "The Ice Wharf - JD Wetherspoon")).toBe(true);
    expect(body.stops.flatMap((stop: { alternatives: Array<{ venueName: string }> }) => stop.alternatives)
      .every((alternative: { venueName: string }) => alternative.venueName === "The Ice Wharf - JD Wetherspoon")).toBe(true);
    expect(body.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({
      code: "accessibility",
      status: "satisfied",
    }));
  });

  it("returns no route rather than treating unknown access facts as accessible", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("unknown-1"),
      generatedVenue("unknown-2"),
      generatedVenue("unknown-3"),
      generatedVenue("unknown-4"),
    ]);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query: "Clapham",
        intake: generationIntake({ accessibilityNeeds: ["step-free"] }),
      }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "GROUNDED_CONSTRAINTS_UNSATISFIED",
      details: { rejected: { accessibility: 4 } },
    });
  });

	it.each(["seating", "low-noise"] as const)(
		"returns no real-catalogue route when distinct %s evidence is unavailable",
		async (need) => {
			const response = await POST(new Request("http://localhost/api/plans/generate", {
				method: "POST",
				body: JSON.stringify({ intake: generationIntake({ accessibilityNeeds: [need] }) }),
			}));
			expect(response.status).toBe(422);
			expect(await response.json()).toMatchObject({ code: "GROUNDED_CONSTRAINTS_UNSATISFIED" });
		},
	);

  it("returns no route when a dated route lacks opening evidence", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-07-20T12:00:00.000Z"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("ordinary-1"),
      generatedVenue("ordinary-2"),
      generatedVenue("ordinary-3"),
      generatedVenue("ordinary-4"),
    ]);
    try {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ intake: generationIntake({
          timeWindow: {
            id: "after-work",
            start: "17:30",
            end: "20:30",
            exactStartIso: "2026-07-20T16:30:00.000Z",
          },
          skipped: [],
        }) }),
      }));
      const body = await response.json();
      expect(response.status).toBe(422);
      expect(body).toMatchObject({ code: "GROUNDED_CONSTRAINTS_UNSATISFIED" });
    } finally {
      clock.mockRestore();
    }
  });
});

describe("exact selected route revalidation", () => {
  const baseIds = ["v1", "v2", "v3"];
  const selectedIds = ["v4", "v2", "v3"];
  let catalogue: ConciergeVenue[];
  let pence: Map<string, number>;
  let restore: Array<() => void>;
  let previousCategoryRead: ReturnType<typeof categoryIndexMock.getMockImplementation>;
  let previousCatalogueRead: ReturnType<typeof loadConciergeVenuesMock.getMockImplementation>;

  beforeEach(() => {
    catalogue = ["v1", "v2", "v3", "v4", "v5"].map((id) => generatedVenue(id));
    pence = new Map(catalogue.map((venue) => [venue.id, 500]));
    restore = [];
    previousCategoryRead = categoryIndexMock.getMockImplementation();
    previousCatalogueRead = loadConciergeVenuesMock.getMockImplementation();
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockReset();
    loadConciergeVenuesMock.mockImplementation(async () => catalogue);
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], truncated: false, degraded: false });
    fetchWalkLegRouteMock.mockReset();
    fetchWalkLegRouteMock.mockResolvedValue(null);
    orsApiKeyMock.mockReset();
    orsApiKeyMock.mockReturnValue(null);
    walkRouteStoreMock.getLeg.mockReset();
    walkRouteStoreMock.getLeg.mockResolvedValue(null);
    walkRouteStoreMock.putLeg.mockReset();
    walkRouteStoreMock.putLeg.mockResolvedValue(undefined);
    vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", "exact-route-fixture-signing-key-never-production");
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    restore.push(() => clock.mockRestore());
    // Replace catalogue evidence reads, not eligibility, route evaluation or
    // proof policy. Fixture prices have public publisher tuples and pass the
    // real evidence builder before the real optimizer reads them.
    const prices = vi.spyOn(routeEvidence, "planPriceEvidenceForVenues").mockImplementation(async (venues, now) =>
      new Map(venues.map((venue) => [venue.id, buildPriceEvidence({
        pence: pence.get(venue.id), label: `Fixture menu ${venue.id}`,
        url: `https://pub.example/${venue.id}/menu`, observedAt: new Date(PLAN_GENERATION_TEST_NOW).toISOString(), now,
      })])),
    );
    restore.push(() => prices.mockRestore());
  });

  afterEach(() => {
    for (const release of restore.reverse()) release();
    categoryIndexMock.mockReset();
    if (previousCategoryRead) categoryIndexMock.mockImplementation(previousCategoryRead);
    loadConciergeVenuesMock.mockReset();
    if (previousCatalogueRead) loadConciergeVenuesMock.mockImplementation(previousCatalogueRead);
    listedBundleFixture.rows = null;
    listedBundleFixture.status = "ready";
    listedBundleFixture.indexCoverage = null;
    vi.unstubAllEnvs();
  });

  async function generateExact(routeVenueIds: unknown, extra: Record<string, unknown> = {}) {
    return POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "Clapham", intake: generationIntake(), routeVenueIds, ...extra }),
    }));
  }

  async function expectRefusal(response: Response) {
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(422);
    expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
    expect(body.groundingProof).toBeUndefined();
    expect(body.stops).toBeUndefined();
  }

  it("returns selected replacements in exact order with fresh attributable evidence and proof", async () => {
    for (const ids of [selectedIds, ["v3", "v4", "v2"]]) {
      const response = await generateExact(ids);
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(ids);
      expect(body.grounded).toBe(true);
      for (const stop of body.stops) {
        expect(stop.priceEvidence).toMatchObject({ pence: 500, source: {
          label: `Fixture menu ${stop.venueId}`, url: `https://pub.example/${stop.venueId}/menu`,
          observedAt: new Date(PLAN_GENERATION_TEST_NOW).toISOString(),
        } });
      }
      expect(verifyPlanGroundingProof(body.groundingProof, ids, body.operationKey)).toBe(true);
      expect(verifyPlanGroundingProof(body.groundingProof, ids, "different-operation")).toBe(false);
    }
  });

  it("revalidates a feasible selected pub beyond the search shortlist", async () => {
    catalogue = Array.from({ length: 16 }, (_, index) => generatedVenue(`v${index + 1}`, {
      lat: 51.462 + index * 0.0002, lng: -0.138,
    }));
    pence = new Map(catalogue.map((venue) => [venue.id, 500]));
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "Clapham", intake: generationIntake() }),
    }));
    expect("prepared" in prepared).toBe(true);
    if (!("prepared" in prepared)) throw new Error("public catalogue control did not prepare");
    expect(prepared.prepared.candidates.findIndex(({ venue }) => venue.id === "v16")).toBeGreaterThanOrEqual(14);
    const ids = ["v16", "v2", "v3"];
    const response = await generateExact(ids);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(ids);
    expect(verifyPlanGroundingProof(body.groundingProof, ids, body.operationKey)).toBe(true);
  });

  it("retains ordinary generation when no exact selection is requested", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "Clapham", intake: generationIntake() }),
    }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.stops).toHaveLength(3);
    expect(new Set(body.stops.map((stop: { venueId: string }) => stop.venueId)).size).toBe(3);
    expect(verifyPlanGroundingProof(body.groundingProof, body.stops.map((stop: { venueId: string }) => stop.venueId), body.operationKey)).toBe(true);
  });

  it.each([
    ["duplicate", ["v1", "v1", "v3"]],
    ["oversized", Array.from({ length: 7 }, (_, index) => `v${index}`)],
  ])("refuses %s before spending generation budget", async (_label, ids) => {
    const response = await generateExact(ids);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MALFORMED_REQUEST" });
    expect(isLimitedMock).not.toHaveBeenCalled();
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it("rejects a selection whose count differs from the reconciled request", async () => {
    const response = await generateExact(["v1", "v2"], { context: { stopCount: 3 } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "MALFORMED_REQUEST" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it("uses answered intake count before explicit context count in exact mode", async () => {
    const response = await generateExact(["v4"], {
      context: { stopCount: 6 }, intake: generationIntake({ stopCount: 1 }),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(["v4"]);
    expect(body.inferredContext.stopCount).toBe(1);
    expect(verifyPlanGroundingProof(body.groundingProof, ["v4"], body.operationKey)).toBe(true);
  });

  it.each(["unknown", "wrong-area", "promoted"] as const)("does not replace a selected %s venue with a better-ranked pub", async (kind) => {
    if (kind === "wrong-area") catalogue.find((venue) => venue.id === "v4")!.lat = 52;
    if (kind === "promoted") catalogue.find((venue) => venue.id === "v4")!.promoted = true;
    await expectRefusal(await generateExact(kind === "unknown" ? ["unknown", "v2", "v3"] : selectedIds));
  });

  it("keeps a pending exclusion eligible but refuses the same approved reviewed avoid without replacement", async () => {
    const originalSnapshot = { ...nightSignalSnapshot };
    const observedAt = new Date(PLAN_GENERATION_TEST_NOW).toISOString();
    const claim: NightSignalClaim = {
      id: "fixture-v4-reviewed-avoid", kind: "opening", entity: { type: "venue", id: "v4" },
      claim: "Fixture reviewed stop exclusion.", publisher: "Fixture pub",
      sourceUrl: "https://pub.example/v4/status",
      publishedAt: new Date(PLAN_GENERATION_TEST_NOW - 1_000).toISOString(),
      observedAt, expiresAt: new Date(PLAN_GENERATION_TEST_NOW + 60 * 60 * 1_000).toISOString(),
      confidence: 1, reviewState: "pending", verification: "manual_review", routeEffect: "avoid",
      corroboratingSources: [], reviewedAt: observedAt, reviewAuthority: "operations",
    };
    try {
      expect(validateNightSignalClaim(claim)).not.toBeNull();
      Object.assign(nightSignalSnapshot, { version: 1, generatedAt: observedAt, claims: [claim] });
      const pending = await generateExact(selectedIds);
      const pendingBody = await pending.json();
      expect(pending.status, JSON.stringify(pendingBody)).toBe(200);
      expect(pendingBody.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(selectedIds);
      expect(verifyPlanGroundingProof(pendingBody.groundingProof, selectedIds, pendingBody.operationKey)).toBe(true);
      const approved = { ...claim, reviewState: "approved" as const };
      expect(validateNightSignalClaim(approved)).not.toBeNull();
      Object.assign(nightSignalSnapshot, { version: 1, generatedAt: observedAt, claims: [approved] });
      await expectRefusal(await generateExact(selectedIds));
    } finally {
      Object.assign(nightSignalSnapshot, originalSnapshot);
    }
  });

  it("rejects combined swaps that break a ceiling although each single swap fits", async () => {
    pence.set("v4", 900);
    pence.set("v5", 900);
    const intake = generationIntake({ budget: { tier: "value", limitPence: 2_000 } });
    for (const ids of [["v4", "v2", "v3"], ["v1", "v5", "v3"]]) {
      const response = await generateExact(ids, { intake });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(ids);
      expect(body.constraintReport.hardConstraints).toContainEqual(expect.objectContaining({ code: "budget_ceiling", status: "satisfied" }));
    }
    await expectRefusal(await generateExact(["v4", "v5", "v3"], { intake }));
  });

  it("refuses selected unknown accessibility instead of choosing accessible alternatives", async () => {
    for (const venue of catalogue) {
      if (venue.id !== "v4") venue.name = "The Ice Wharf - JD Wetherspoon";
    }
    const intake = generationIntake({ accessibilityNeeds: ["step-free"] });
    const control = await generateExact(baseIds, { intake });
    expect(control.status, await control.clone().text()).toBe(200);
    await expectRefusal(await generateExact(selectedIds, { intake }));
  });

  it("refuses an exact route whose chosen order breaks the walking limit", async () => {
    catalogue.find((venue) => venue.id === "v4")!.lat = 51.478;
    catalogue.find((venue) => venue.id === "v5")!.lat = 51.446;
    const control = await generateExact(baseIds);
    expect(control.status, await control.clone().text()).toBe(200);
    await expectRefusal(await generateExact(["v4", "v5", "v2"]));
  });

  it("refuses dated selected stops without opening evidence", async () => {
    const futureStart = new Date(PLAN_GENERATION_TEST_NOW + 24 * 60 * 60 * 1_000);
    futureStart.setUTCHours(16, 30, 0, 0); // 17:30 London, inside after-work.
    const exactStartIso = futureStart.toISOString();
    const intake = generationIntake({
      timeWindow: { id: "after-work", start: "17:30", end: "20:30", exactStartIso }, skipped: [],
    });
    const opening = vi.spyOn(routeEvidence, "planOpeningSchedulesForVenues").mockImplementation(async (venues) =>
      new Map(venues.map((venue) => [venue.id, baseIds.includes(venue.id) ? {
        venueListedOpen: true,
        ranges: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((weekday) => ({
          weekday, startsAt: "17:00", endsAt: "23:00",
        })),
        source: { label: `Fixture hours ${venue.id}`, url: `https://pub.example/${venue.id}/hours`,
          observedAt: new Date(PLAN_GENERATION_TEST_NOW).toISOString() },
      } : null])),
    );
    restore.push(() => opening.mockRestore());
    const control = await generateExact(baseIds, { intake });
    const controlBody = await control.json();
    expect(control.status, JSON.stringify(controlBody)).toBe(200);
    expect(controlBody.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(baseIds);
    for (const stop of controlBody.stops) {
      expect(stop.operationalEvidence).toMatchObject({ openingAtVisit: "listed_open", openingSource: {
        label: `Fixture hours ${stop.venueId}`, url: `https://pub.example/${stop.venueId}/hours`,
        observedAt: new Date(PLAN_GENERATION_TEST_NOW).toISOString(),
      } });
    }
    await expectRefusal(await generateExact(selectedIds, { intake }));
  });

  it("keeps unsupported transport fail-closed in exact mode", async () => {
    await expectRefusal(await generateExact(selectedIds, { context: { transportConstraints: ["night-tube"] } }));
  });

  it("does not borrow pint evidence for a no-alcohol budget ceiling", async () => {
    await expectRefusal(await generateExact(selectedIds, {
      context: { zeroProof: true }, intake: generationIntake({ budget: { tier: "value", limitPence: 2_000 } }),
    }));
  });

  it("keeps selected wine publisher tuples on their exact venues without pint fallback", async () => {
    const observedAt = new Date(PLAN_GENERATION_TEST_NOW).toISOString();
    listedBundleFixture.rows = catalogue.map((venue, index) => ({
      venueId: venue.id, name: venue.name, category: "wine", priceGbp: 5 + index,
      drinkLabel: `Named wine ${venue.id}`, servingSize: "125ml", lane: "site-harvest", standing: "listed",
      sourceUrl: `https://pub.example/${venue.id}/wine`, observedAt, publisher: "Fixture publisher", basis: null, sampleSize: null,
    }));
    const response = await generateExact(selectedIds, { query: "Wine in Clapham", context: { drinkCategory: "wine" } });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(selectedIds);
    for (const stop of body.stops) {
      const row = listedBundleFixture.rows.find((candidate) => candidate.venueId === stop.venueId)!;
      expect(stop).toMatchObject({ estimatedPintPricePence: null, priceEvidence: null, selectedDrinkPriceEvidence: {
        category: "wine", pence: Math.round(row.priceGbp * 100), serving: "125ml", source: "listed",
        sourceUrl: row.sourceUrl, observedAt,
      } });
    }
  });

  it("rechecks matching held Stop 1 and binds the fresh V2 proof to exact companion order", async () => {
    const resolution = vi.spyOn(anchorResolution, "resolvePlanningAnchor").mockResolvedValue({
      status: "resolved", display: { venueId: "v1", venueName: "Venue v1", areaName: "Clapham", startLabel: null,
        priceEvidence: null, routeWindowOk: true, budgetCompatible: true, accessibilityCompatible: true },
      canonical: { cityId: "london", venueId: "v1", nightAreaSlug: "clapham", acceptedArea: { kind: "night-patch", id: "clapham" },
        coordinates: { lat: 51.463, lng: -0.137 }, startsAt: null, priceObservedAt: null, priceFreshnessKind: "unknown" },
    });
    restore.push(() => resolution.mockRestore());
    const anchor = { venueId: "v1", source: "pal", acceptedArea: { kind: "night-patch", id: "clapham" }, startsAt: null };
    const ids = ["v1", "v4", "v3"];
    const response = await generateExact(ids, { anchor });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toEqual(ids);
    expect(body).toMatchObject({ grounded: true, anchored: true, anchorVenueId: "v1", anchorSource: "pal", outcome: "route" });
    expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof, ids, body.operationKey)).toMatchObject({ ok: true, routeVenueIds: ids });
    expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof, ["v1", "v3", "v4"], body.operationKey)).toEqual({ ok: false, reason: "route-mismatch" });
    const conflict = await generateExact(["v4", "v1", "v3"], { anchor });
    expect(conflict.status).toBe(200);
    expect(await conflict.json()).toMatchObject({ outcome: "anchor-conflict", grounded: false, routeReady: false, stops: [] });
  });
});
