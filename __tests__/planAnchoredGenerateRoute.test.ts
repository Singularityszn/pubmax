import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listedBundleFixture = vi.hoisted(() => ({
  rows: null as import("@/lib/ukPriceBundle").UkPriceBundleRow[] | null,
  status: "ready" as "ready" | "empty" | "unavailable",
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
      return { prices, truncated: false, degraded: listedBundleFixture.status === "unavailable" };
    },
  };
});


const { isLimitedMock, loadConciergeVenuesMock, resolvePlanningAnchorMock, categoryIndexMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
  loadConciergeVenuesMock: vi.fn(),
  resolvePlanningAnchorMock: vi.fn(),
  categoryIndexMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
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
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: vi.fn(() => null),
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: vi.fn(async () => null), putLeg: vi.fn(async () => undefined) }),
}));
vi.mock("@/lib/communityPriceStore", () => ({
  readCommunityPriceCategoryIndex: categoryIndexMock,
}));
vi.mock("@/lib/planningAnchor.server", () => ({ resolvePlanningAnchor: resolvePlanningAnchorMock }));

import { POST } from "@/app/api/plans/generate/route";
import { verifyAnchoredPlanGroundingProofV2 } from "@/lib/planGrounding.server";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { PlanIntakeHandoff } from "@/lib/planIntake";

function claphamVenue(id: string, index: number, options: Partial<ConciergeVenue> = {}): ConciergeVenue {
  return {
    id,
    name: `Venue ${id}`,
    area: "Lambeth",
    lat: 51.462 + index * 0.001,
    lng: -0.138 + index * 0.001,
    cheapestPrice: 5,
    amenities: { beerGarden: false, cocktails: false, food: false, liveSports: false, liveMusic: false },
    nearWater: false,
    hasStory: false,
    canonical: true,
    ...options,
  };
}

function intake(overrides: Partial<PlanIntakeHandoff> = {}): PlanIntakeHandoff {
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

function resolved(venueId: string) {
  return {
    status: "resolved" as const,
    display: {
      venueId, venueName: "Anchor", areaName: "Clapham", startLabel: null,
      priceEvidence: null, routeWindowOk: true, budgetCompatible: true, accessibilityCompatible: true,
    },
    canonical: {
      cityId: "london" as const, venueId, nightAreaSlug: "clapham-high-street", acceptedArea: { kind: "night-patch" as const, id: "clapham" as const },
      coordinates: { lat: 51.462, lng: -0.138 }, startsAt: null, priceObservedAt: null, priceFreshnessKind: "unknown" as const,
    },
  };
}

function generate(body: Record<string, unknown>): Promise<Response> {
  return POST(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify(body),
  }));
}

const ANCHOR = { venueId: "anchor-venue", source: "near", acceptedArea: { kind: "night-patch", id: "clapham" }, startsAt: null };

describe("POST /api/plans/generate — anchored", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockClear();
    resolvePlanningAnchorMock.mockReset();
    categoryIndexMock.mockReset();
    categoryIndexMock.mockResolvedValue({ prices: [], degraded: false, truncated: false });
    process.env.PLAN_IDEMPOTENCY_SECRET = "a".repeat(48);
  });
  afterEach(() => {
    delete process.env.PLAN_IDEMPOTENCY_SECRET;
  });

  it("keeps generic generation unanchored when no accepted Venue is supplied", async () => {
    const response = await generate({ query: "Four of us after work in Clapham, cheap and lively" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.grounded).toBe(true);
    expect(body.stops).toHaveLength(3);
    expect(body.outcome).toBeUndefined();
    expect(body.anchored).toBeUndefined();
    expect(resolvePlanningAnchorMock).not.toHaveBeenCalled();
  });

  it("handles an accepted Venue by default and returns it first with a valid V2 proof", async () => {
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      claphamVenue("anchor-venue", 0, { cheapestPrice: 5 }),
      claphamVenue("companion-1", 1, { cheapestPrice: 4 }),
      claphamVenue("companion-2", 2, { cheapestPrice: 4 }),
      claphamVenue("companion-3", 3, { cheapestPrice: 6 }),
    ]);
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: true, outcome: "route", anchored: true, routeReady: true,
      anchorVenueId: "anchor-venue", anchorSource: "near",
    });
    expect(body.stops[0].venueId).toBe("anchor-venue");
    expect(body.stops[0].alternatives).toEqual([]);
    const verdict = verifyAnchoredPlanGroundingProofV2(
      body.groundingProof,
      body.stops.map((stop: { venueId: string }) => stop.venueId),
      body.operationKey,
    );
    expect(verdict).toMatchObject({ ok: true, anchored: true, outcome: "route", anchorVenueId: "anchor-venue" });
  });

  it("retains source-stated listed wine on an anchor-only draft without upgrading it to a route", async () => {
    const now = Date.parse("2026-09-30T12:00:00.000Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const observedAt = "2026-09-29T12:00:00.000Z";
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([claphamVenue("anchor-venue", 0)]);
    listedBundleFixture.status = "ready";
    listedBundleFixture.rows = [{ venueId: "anchor-venue", name: "Anchor", category: "wine", priceGbp: 6.25,
      drinkLabel: "Chenin", servingSize: "125ml", lane: "site-harvest", standing: "listed",
      sourceUrl: "https://pub.example/anchor/menu", observedAt, publisher: "Fixture publisher", basis: null, sampleSize: null }];
    try {
      const response = await generate({ query: "Quiet wine in Clapham for 2", anchor: ANCHOR });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({ outcome: "anchor-only", routeReady: false, anchorVenueId: "anchor-venue" });
      expect(body.stops).toHaveLength(1);
      expect(body.stops[0]).toMatchObject({ estimatedPintPricePence: null, priceEvidence: null,
        selectedDrinkPriceEvidence: { category: "wine", pence: 625, serving: "125ml", source: "listed",
          sourceUrl: "https://pub.example/anchor/menu", observedAt } });
      expect(verifyAnchoredPlanGroundingProofV2(body.groundingProof, ["anchor-venue"], body.operationKey))
        .toMatchObject({ ok: true, anchored: true, outcome: "anchor-only" });
    } finally { clock.mockRestore(); listedBundleFixture.rows = null; }
  });

  it("keeps corroborated wine evidence in an anchor-only draft", async () => {
    const now = Date.now();
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([claphamVenue("anchor-venue", 0)]);
    categoryIndexMock.mockResolvedValueOnce({
      prices: [{ venueId: "anchor-venue", drinkCategory: "wine", priceGbp: 6.75,
        submittedAt: now, source: "community", corroborations: 2 }],
      degraded: false, truncated: false,
    });
    const response = await generate({ query: "Quiet wine in Clapham for 2", anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("anchor-only");
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0]).toMatchObject({
      estimatedPintPricePence: null, priceEvidence: null,
      selectedDrinkPriceEvidence: { category: "wine", pence: 675, serving: null,
        source: "community", reportedAt: new Date(now).toISOString() },
    });
  });

  it("returns anchor-only when companions are insufficient", async () => {
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      claphamVenue("anchor-venue", 0),
      claphamVenue("companion-1", 1),
    ]);
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: true, outcome: "anchor-only", anchored: true, routeReady: false,
      reason: "ANCHOR_COMPANIONS_INSUFFICIENT", anchorVenueId: "anchor-venue",
    });
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0].venueId).toBe("anchor-venue");
    const verdict = verifyAnchoredPlanGroundingProofV2(body.groundingProof, ["anchor-venue"], body.operationKey);
    expect(verdict).toMatchObject({ ok: true, outcome: "anchor-only", anchored: true });
  });

  it("surfaces a resolver conflict as an anchor-conflict outcome", async () => {
    resolvePlanningAnchorMock.mockResolvedValue({
      status: "conflict", code: "ANCHOR_AREA_CONFLICT", message: "outside area",
    });
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: false, outcome: "anchor-conflict", anchored: true, routeReady: false,
      stops: [], reason: "ANCHOR_AREA_CONFLICT",
    });
  });

  it("returns a route conflict when the anchor is absent from the area candidates", async () => {
    resolvePlanningAnchorMock.mockResolvedValue(resolved("anchor-venue"));
    loadConciergeVenuesMock.mockResolvedValueOnce([
      claphamVenue("companion-1", 1),
      claphamVenue("companion-2", 2),
      claphamVenue("companion-3", 3),
    ]);
    const response = await generate({ intake: intake(), anchor: ANCHOR });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      grounded: false, outcome: "anchor-conflict", reason: "ANCHOR_ROUTE_CONFLICT",
    });
  });
});
