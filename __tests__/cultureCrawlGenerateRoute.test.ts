import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isLimitedMock, priceFixture } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
  // When on, every canonical pint price is a labelled test fixture observed
  // one hour before the route's own clock, in place of the shipped dataset
  // file. The real freshness and ceiling policy still judges each row.
  priceFixture: { on: false },
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// Hermetic weather: the live refresh workflow rewrites the shipped snapshot,
// and this file only ever asserts the culture opener beside the route.
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: isLimitedMock };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: () => null,
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: async () => null, putLeg: async () => undefined }),
}));
vi.mock("@/lib/planRouteEvidence.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planRouteEvidence.server")>();
  const { buildPriceEvidence } = await vi.importActual<typeof import("@/lib/planRouteEvidence")>(
    "@/lib/planRouteEvidence",
  );
  return {
    ...actual,
    planPriceEvidenceForVenues: async (
      venues: Parameters<typeof actual.planPriceEvidenceForVenues>[0],
      now: number,
    ) => priceFixture.on
      ? new Map(venues.map((venue) => [venue.id, buildPriceEvidence({
        pence: 550,
        label: "Test fixture pint price",
        url: "https://example.org/test-fixture/pint-prices",
        observedAt: new Date(now - 60 * 60 * 1000).toISOString(),
        now,
      })]))
      : actual.planPriceEvidenceForVenues(venues, now),
  };
});

import { POST } from "@/app/api/plans/generate/route";
import {
  CULTURE_CRAWL_CHIPS,
  CULTURE_WAYPOINT_MAX_KM,
  CULTURE_WAYPOINT_NONE_NOTE,
} from "@/lib/cultureCrawl";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import {
  createPlanIntakeDraft,
  planIntakeHandoff,
  skipRemainingPlanIntake,
} from "@/lib/planIntake";

// Exactly the body the describe-first surface sends: every wizard step skipped.
// The bare { query } shape takes the LEGACY selection path and would let a chip
// that the real grounded optimizer refuses pass this file.
const DESCRIBE_FIRST_INTAKE = planIntakeHandoff(skipRemainingPlanIntake(createPlanIntakeDraft()));

async function generate(query: string, context?: Record<string, unknown>) {
  const response = await POST(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify({ query, intake: DESCRIBE_FIRST_INTAKE, ...(context ? { context } : {}) }),
  }));
  return { status: response.status, body: await response.json() };
}

describe("Culture Crawl chips through POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(CULTURE_CRAWL_CHIPS)(
    "weaves a POI waypoint and three pub stops for $id",
    async (chip) => {
      const { status, body } = await generate(chip.query);
      expect(status).toBe(200);
      expect(body.grounded).toBe(true);
      expect(body.stops).toHaveLength(3);
      expect(body.cultureOpener).toBeTruthy();
      expect(body.cultureOpener.requested.length).toBeGreaterThan(0);
      expect(body.cultureOpener.waypoint, `${chip.id} lost its waypoint`).toBeTruthy();
      expect(body.cultureOpener.note).not.toBe(CULTURE_WAYPOINT_NONE_NOTE);
      expect(body.cultureOpener.waypoint.distanceKm).toBeLessThanOrEqual(CULTURE_WAYPOINT_MAX_KM);
    },
  );

  it("keeps the waypoint out of the Stops, the grounding proof and the totals", async () => {
    const { body } = await generate(CULTURE_CRAWL_CHIPS[0]!.query);
    const waypoint = body.cultureOpener.waypoint;
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).not.toContain(waypoint.poiId);
    expect(body.routeTotals.stopCount).toBe(3);
    expect(JSON.stringify(body.stops)).not.toContain(waypoint.poiId);
    // A waypoint carries no figure, so nothing about it can reach a price lane.
    expect(Object.keys(waypoint)).not.toContain("estimatedPintPricePence");
    expect(Object.keys(waypoint)).not.toContain("priceEvidence");
  });

  it("leaves an ordinary describe chip byte-identical", async () => {
    for (const chip of DESCRIBE_FIRST_CHIPS) {
      const { body } = await generate(chip);
      expect(Object.keys(body)).not.toContain("cultureOpener");
    }
  });
});

const GALLERY_CHIP = CULTURE_CRAWL_CHIPS.find((chip) => chip.id === "gallery-pint")!;
const RIVER_CHIP = CULTURE_CRAWL_CHIPS.find((chip) => chip.id === "river-historic")!;
const MARKET_CHIP = CULTURE_CRAWL_CHIPS.find((chip) => chip.id === "market-kebab")!;

type GeneratedStop = {
  venueId: string;
  venueName: string;
  estimatedPintPricePence: number | null;
  priceEvidence: { source: { label: string; url: string; observedAt: string } | null } | null;
};

describe("A Culture Crawl with a chosen budget through POST /api/plans/generate", () => {
  beforeEach(() => {
    isLimitedMock.mockClear();
    isLimitedMock.mockResolvedValue(false);
    priceFixture.on = true;
  });

  afterEach(() => {
    priceFixture.on = false;
  });

  it("itemises each fixture pint with its source and keeps the subtotal partial", async () => {
    const { status, body } = await generate(GALLERY_CHIP.query, { budgetLimitPence: 4000 });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.stops).toHaveLength(3);
    expect(body.cultureOpener.waypoint).toBeTruthy();
    const costs = body.cultureOpener.costs;
    expect(costs.limitPence).toBe(4000);
    expect(costs.knownItems).toEqual(body.stops.map((stop: GeneratedStop) => ({
      venueId: stop.venueId,
      venueName: stop.venueName,
      pence: stop.estimatedPintPricePence,
      source: stop.priceEvidence?.source ?? null,
    })));
    for (const item of costs.knownItems) {
      expect(item.pence).toBe(550);
      expect(item.source).toMatchObject({
        label: "Test fixture pint price",
        url: "https://example.org/test-fixture/pint-prices",
        observedAt: expect.any(String),
      });
    }
    expect(costs.knownSubtotalPence).toBe(1650);
    expect(costs.unknownItems).toEqual(["admission", "food", "transport"]);
  });

  it("never says the outing fits the budget while a cost is unknown", async () => {
    const { status, body } = await generate(GALLERY_CHIP.query, { budgetLimitPence: 4000 });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.budgetSummary).toMatchObject({ limitPence: 4000, estimatedPerPersonPence: 1650 });
    expect(body.budgetSummary.withinLimit).toBeNull();
    expect(JSON.stringify(body.cultureOpener)).not.toMatch(/\bfree\b/i);
  });

  it("keeps admission unknown for an open-air waypoint with no sourced admission fact", async () => {
    const { status, body } = await generate(RIVER_CHIP.query, { budgetLimitPence: 4000 });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.cultureOpener.waypoint.category).toBe("river");
    expect(body.cultureOpener.costs.unknownItems).toEqual(["admission", "food", "transport"]);
    expect(body.budgetSummary.withinLimit).toBeNull();
  });

  it("keeps an alcohol-free outing eligible without a pint price", async () => {
    const { status, body } = await generate(MARKET_CHIP.query, { zeroProof: true });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.stops).toHaveLength(3);
    expect(body.cultureOpener.waypoint).toBeTruthy();
    for (const stop of body.stops as GeneratedStop[]) expect(stop.estimatedPintPricePence).toBeNull();
    expect(body.cultureOpener.costs).toEqual({
      limitPence: null,
      knownSubtotalPence: null,
      knownItems: [],
      unknownItems: ["admission", "drinks", "food", "transport"],
    });
  });

  it("answers a budget no route can meet with scarcity and no culture opener", async () => {
    const { status, body } = await generate(GALLERY_CHIP.query, { budgetLimitPence: 500 });
    expect(status).toBe(422);
    expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
    expect(body).not.toHaveProperty("cultureOpener");
    expect(body).not.toHaveProperty("stops");
  });
});
