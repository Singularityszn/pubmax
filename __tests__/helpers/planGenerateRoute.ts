import { afterEach, beforeEach, vi } from "vitest";

// ONE MOCK SEAM FOR EVERY POST /api/plans/generate SUITE.
//
// The route suites are split by topic because Vitest spreads files across
// workers, never the tests inside one file. Every suite shares the mocks, the
// fixtures and the hooks written here.
//
// vi.mock and vi.hoisted are hoisted to the top of THIS module, above its own
// imports, so the route and the planning modules below always load with the
// mocks in place. A suite takes the route and those modules from here, never
// from their own paths: an import of the real path ahead of this module would
// load them unmocked. Each suite calls installPlanGenerateRouteHooks() at the
// top of its describe.

vi.mock("server-only", () => ({}));

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
// invent weather" assertion. Pin an empty snapshot so no route suite ever
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

import * as generateRoute from "@/app/api/plans/generate/route";
import * as priceLimits from "@/lib/planPriceLimits";
import * as nightPlanning from "@/lib/nightPlanning";
import * as routeEvidenceServer from "@/lib/planRouteEvidence.server";
import * as routeEvidence from "@/lib/planRouteEvidence";
import * as planGeneration from "@/lib/planGeneration.server";
import * as planGrounding from "@/lib/planGrounding.server";
import { PINT_DATASET_TEST_NOW } from "@/__tests__/helpers/pintDatasetClock";
import * as supabase from "@/lib/supabase";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import type { PlanIntakeHandoff } from "@/lib/planIntake";

// Because this module calls vi.mock, Vitest turns each import above into an
// awaited dynamic import. An `export { name }` of an imported name then
// exports undefined, so each one is re-exported as a const read from its
// module. The mocks are hoisted constants and export as they are.
export const { GET, POST } = generateRoute;
export const { planPriceAmounts, planPriceLimits } = priceLimits;
export const { inferNightContext } = nightPlanning;
export const { planPriceEvidenceForVenues } = routeEvidenceServer;
export const { priceEvidenceUsableForCeiling } = routeEvidence;
export const { preparePlanGeneration } = planGeneration;
export const { verifyPlanGroundingProof } = planGrounding;
export const { hashIp } = supabase;
export {
  categoryIndexMock,
  fetchWalkLegRouteMock,
  isLimitedMock,
  loadConciergeVenuesMock,
  orsApiKeyMock,
  walkRouteStoreMock,
};

export const PLAN_GENERATION_TEST_NOW = PINT_DATASET_TEST_NOW;

/** Whether any request so far charged a paid-spend lane. Plan generation must not. */
export function chargedPaidLane(): boolean {
  return isLimitedMock.mock.calls.some(([key]) => String(key).startsWith("paid-spend:"));
}

export function generationIntake(
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

export function generatedVenue(
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

export async function cappedTestVenues(): Promise<ConciergeVenue[]> {
  const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
  const venues = await actual.loadConciergeVenues("london");
  return ["Feeley's", "The Beehive", "Effra Social", "Prince of Wales"].map((name) => {
    const venue = venues.find((candidate) => candidate.name === name);
    if (!venue) throw new Error(`Missing canonical fixture: ${name}`);
    return venue;
  });
}

export function prepareWineValueSearch(now: number, query = "cheap wine in Clapham for 2") {
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
  return preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
    method: "POST",
    body: JSON.stringify({ query }),
  }), now);
}

export function drinkRatePhrases(pounds: number): string[] {
  return ["pint", "beer", "drink"].flatMap((item) => [
    `${item}s under£${pounds}`,
    `£${pounds} for a ${item}`,
    `£${pounds} per ${item}`,
    `${item}s priced under £${pounds}`,
    `${item}s costing under £${pounds}`,
    `${item}s for under£${pounds}`,
    `${item}s cost £${pounds}`,
    `${item}s priced for under £${pounds}`,
    `${item}s costing for under£${pounds}`,
    `under £${pounds} for a ${item}`,
    `maximum £${pounds} per ${item}`,
    `£${pounds} a ${item}`,
    `£${pounds} ${item}s`,
    `${item}s priced under ${pounds} pounds`,
    `${item}s costing under ${pounds} quid`,
    `${item}s for under £${pounds},00`,
    `one ${item} under£${pounds}`,
    `1 ${item} under£${pounds}`,
    `£${pounds} for one ${item}`,
  ]).concat(["pint of beer", "a pint of beer", "one pint of beer", "1 pint of beer", "pint of the beer"].flatMap((subject) => [
    `${subject} under£${pounds}`,
    `£${pounds} for ${subject}`,
  ]));
}

export function drinkRateInputs(phrase: string) {
  return [
    { query: `3 pubs in Clapham, ${phrase}, pizza afterwards`, total: null },
    { query: `3 pubs in Clapham, ${phrase}, under£20 per person, pizza afterwards`, total: 2000 },
    { query: `3 pubs in Clapham, under£20 per person, ${phrase}, pizza afterwards`, total: 2000 },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase] }, total: null },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase, "pub route budget of£20"] }, total: 2000 },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pub route budget of£20", phrase, "pizza"] }, total: 2000 },
  ];
}

export const unsupportedServingSubjects = [
  "2x330ml beers", "2 x 330 ml beers", "2×330ml beers", "two x 330 ml beers",
  "3x500ml beers", "2x beers", "two×beers", "12 beers", "three beers",
  "330 ml of beer", "330ml of beer", "330 ml of the beer", "330ml of a beer", "33cl of beer", "0.33L of beer",
  "two pints of beer", "half a pint of beer", "half a pint of the beer", "1/2 pint of beer",
  "two bottles of the beer", "a can of beer", "one glass of the beer", "2 shots of beer",
  "seven pints of beer", "a jug of beer", "a litre of beer", "330 millilitres of beer",
  "2 packs of beer", "a pitcher of beer", "a stein of beer", "a six-pack of beer",
  "pint of cider", "pint of 330ml beer", "pint of beer 330ml",
];

/** The hooks every suite registers once, at the top of its describe. */
export function installPlanGenerateRouteHooks(): void {
  beforeEach(async () => {
    isLimitedMock.mockReset();
    isLimitedMock.mockResolvedValue(false);
    loadConciergeVenuesMock.mockReset();
    categoryIndexMock.mockReset();
    const venues = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
    loadConciergeVenuesMock.mockImplementation(venues.loadConciergeVenues);
    const prices = await vi.importActual<typeof import("@/lib/communityPriceStore")>("@/lib/communityPriceStore");
    categoryIndexMock.mockImplementation(prices.readCommunityPriceCategoryIndex);
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
}
