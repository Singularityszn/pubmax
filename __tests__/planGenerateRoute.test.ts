import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { planPriceAmounts, planPriceLimits } from "@/lib/planPriceLimits";
import { inferNightContext } from "@/lib/nightPlanning";
import { planPriceEvidenceForVenues } from "@/lib/planRouteEvidence.server";
import { priceEvidenceUsableForCeiling } from "@/lib/planRouteEvidence";
import { preparePlanGeneration } from "@/lib/planGeneration.server";
import { verifyPlanGroundingProof } from "@/lib/planGrounding.server";
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

async function cappedTestVenues(): Promise<ConciergeVenue[]> {
  const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
  const venues = await actual.loadConciergeVenues("london");
  return ["Feeley's", "The Beehive", "Effra Social", "Prince of Wales"].map((name) => {
    const venue = venues.find((candidate) => candidate.name === name);
    if (!venue) throw new Error(`Missing canonical fixture: ${name}`);
    return venue;
  });
}

function prepareWineValueSearch(now: number, query = "cheap wine in Clapham for 2") {
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

function drinkRatePhrases(pounds: number): string[] {
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

function drinkRateInputs(phrase: string) {
  return [
    { query: `3 pubs in Clapham, ${phrase}, pizza afterwards`, total: null },
    { query: `3 pubs in Clapham, ${phrase}, under£20 per person, pizza afterwards`, total: 2000 },
    { query: `3 pubs in Clapham, under£20 per person, ${phrase}, pizza afterwards`, total: 2000 },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase] }, total: null },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase, "pub route budget of£20"] }, total: 2000 },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pub route budget of£20", phrase, "pizza"] }, total: 2000 },
  ];
}

const unsupportedServingSubjects = [
  "2x330ml beers", "2 x 330 ml beers", "2×330ml beers", "two x 330 ml beers",
  "3x500ml beers", "2x beers", "two×beers", "12 beers", "three beers",
  "330 ml of beer", "330ml of beer", "330 ml of the beer", "330ml of a beer", "33cl of beer", "0.33L of beer",
  "two pints of beer", "half a pint of beer", "half a pint of the beer", "1/2 pint of beer",
  "two bottles of the beer", "a can of beer", "one glass of the beer", "2 shots of beer",
  "seven pints of beer", "a jug of beer", "a litre of beer", "330 millilitres of beer",
  "2 packs of beer", "a pitcher of beer", "a stein of beer", "a six-pack of beer",
  "pint of cider", "pint of 330ml beer", "pint of beer 330ml",
];

describe("POST /api/plans/generate", () => {
  it.each(["I want", "please get", "we would like", "could you find", "get"].flatMap((request) => [
    ...["one serving weighing 200g under£10", "£10 for one serving weighing 200g"].map((phrase) => ({
      query: `One pub in Soho, ${request} ${phrase}`, context: { stopCount: 1 },
    })),
    ...[" and ", " plus ", "+", "&"].flatMap((join) => [
      `£10 pint at X${join}${request} a serving weighing 2g`,
      `pint at X${join}${request} a serving weighing 2g £10`,
    ]).flatMap((phrase) => [
      { query: `One pub in Soho, ${phrase}`, context: { stopCount: 1 } },
      ...(phrase.length <= 40 ? [{ query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [phrase] } }] : []),
    ]),
  ]))("retains serving ownership after request introductions: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
    const response = await POST(request());
    expect("response" in prepared ? await prepared.response.json() : null)
      .toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    { query: "3 pubs in Clapham, 0.0 beer, maximum £5 per pint" },
    { query: "3 pubs in Clapham, alcohol-free beer, maximum £5 per pint" },
    { query: "3 pubs in Clapham", context: { zeroProof: true, foodNeeds: ["maximum £5 per pint"] } },
  ])("keeps alcohol-free controls separate from canonical pint scarcity: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", { method: "POST", body: JSON.stringify(input) });
    const prepared = await preparePlanGeneration(request(), Date.now());
    expect("response" in prepared ? await prepared.response.json() : null).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
  });

  it.each(["£20.00", "£20,00", "20.00 pounds", "20,00 quid"].flatMap((amount) => [
    { query: `3 pubs in Clapham, ${amount} per person, pints under£5` },
    { query: "3 pubs in Clapham", context: { foodNeeds: [`${amount} per person, pints under£5`] } },
  ]))("preserves decimal per-person totals beside pint caps: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", { method: "POST", body: JSON.stringify(input) });
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      expect(prepared).toHaveProperty("prepared");
      if (!("prepared" in prepared)) throw new Error("Expected route budget preparation");
      expect(prepared.prepared.context).toMatchObject({ zeroProof: false, budgetLimitPence: 2000 });
      const response = await POST(request());
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.inferredContext).toMatchObject({ zeroProof: false, budgetLimitPence: 2000 });
      expect(body.budgetSummary).toMatchObject({ limitPence: 2000, withinLimit: true });
      for (const entry of body.stops.flatMap((stop: { alternatives: unknown[] }) => [stop, ...stop.alternatives])) {
        expect(entry.estimatedPintPricePence).toBeLessThanOrEqual(500);
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["0.01", "10.00", "20.00"].flatMap((amount) => [
    { query: `3 pubs in Clapham, maximum £${amount} per pint`, cap: Number(amount), total: null },
    { query: "3 pubs in Clapham", context: { foodNeeds: [`maximum £${amount} per pint`] }, cap: Number(amount), total: null },
    ...[false, true].map((reverse) => ({
      query: `3 pubs in Clapham, ${reverse ? "maximum £5 per pint, under £20.00 per person" : "under £20.00 per person, maximum £5 per pint"}`,
      cap: 5, total: 2000,
    })),
  ]))("keeps decimal currency out of alcohol-free intent: %j", async ({ cap, total, ...input }) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      });
      expect(inferNightContext(input.query).context.zeroProof).toBe(false);
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      expect(prepared).toHaveProperty("prepared");
      if (!("prepared" in prepared)) throw new Error("Expected canonical cap preparation");
      expect(prepared.prepared.context).toMatchObject({ zeroProof: false, budgetLimitPence: total });
      const response = await POST(request());
      const body = await response.json();
      if (cap < 1) {
        expect(response.status).toBe(422);
        expect(body).toMatchObject({ code: "GROUNDED_VENUES_INSUFFICIENT" });
      } else {
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.inferredContext).toMatchObject({ zeroProof: false, budgetLimitPence: total });
        for (const entry of body.stops.flatMap((stop: { alternatives: unknown[] }) => [stop, ...stop.alternatives])) {
          expect(entry.estimatedPintPricePence).toBeLessThanOrEqual(cap * 100);
          expect(entry.priceEvidence).toMatchObject({ pence: entry.estimatedPintPricePence });
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ...["one warm serving weighing 200g", "one serving containing nuts", "a softly warmed generous serving containing nuts", "each warm serving weighing 2g", "2/3 warm servings containing nuts", "one warm serving that weighs 200g", "one serving that contains nuts", "a 0.5kg serving weighing 200g", "a 0,5kg serving weighing 200g"].flatMap((food) => [
      `${food} under£10`, `£10 for ${food}`,
      ...[" and ", " plus ", "+", "&"].flatMap((join) => [
        `£10 pint${join}${food}`, `pint${join}${food} £10`,
        ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((location) => [
          `£10 pint ${location} X${join}${food}`, `pint ${location} X${join}${food} £10`,
        ]),
      ]),
    ]),
    "£10 pint at X&a warm serving weighing 2g",
    "£10 pint at X&a serving that weighs 2g",
    "one serving containing nuts and under£10",
    ...["one serving pizza", "a serving chips"].flatMap((food) => [" and ", " plus ", "+", "&"].map((join) => `${food}${join}under£10`)),
  ].flatMap((phrase) => [
    ...[", ", " with ", " for "].map((introduction) => ({
      query: `One pub in Soho${introduction}${phrase}`, context: { stopCount: 1 },
    })),
    ...(phrase.length <= 40 ? [{ query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [phrase] } }] : []),
  ]))("retains quantified serving ownership through arbitrary descriptors: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
    const response = await POST(request());
    expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each(["sparkling beer", "sparkling wine", "steaming coffee"].flatMap((object) => [
    { query: `3 pubs in Soho, each serving ${object}, under£20 per person` },
    { query: "3 pubs in Soho", context: { foodNeeds: [`each serving ${object}, under£20`] } },
  ]))("keeps unpriced participial drink descriptions out of meal ownership: %j", async (input) => {
    const request = () => new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    });
    const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
    expect("prepared" in prepared).toBe(true);
    if (!("prepared" in prepared)) throw new Error("Expected a pub route");
    expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
    const response = await POST(request());
    const body = await response.json();
    if (response.status === 200) {
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.stops).toHaveLength(3);
    } else {
      expect(response.status).toBe(422);
      expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
      expect(body.details.rejected.budgetEvidence).toBeGreaterThan(0);
    }
  });

  it.each([
    ...["with a rooftop ", "with a garden ", "each "].flatMap((owner) => ["beer", "drinks", "pints"].map((object) => ({ owner, object }))),
    ...["food", "pizza", "beer and pizza"].map((object) => ({ owner: "pubs ", object })),
  ].flatMap(({ owner, object }) => [" and ", " plus ", "+", "&"].flatMap((join) => {
    const phrase = `${owner}serving ${object}${join}under£20`;
    return [
      { query: `3 pubs in Soho ${phrase} per person` },
      ...(phrase.length <= 40 ? [{ query: "3 pubs in Soho", context: { foodNeeds: [phrase] } }] : []),
    ];
  })))("separates coordinated venue drink predicates from route limits: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      });
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      const response = await POST(request());
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(await response.json()).toMatchObject({ inferredContext: { budgetLimitPence: 2000 }, stops: expect.any(Array) });
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["rooftop", "snug", "mezzanine", "courtyard"].flatMap((venue) => [
    { query: `3 pubs in Soho with a ${venue} serving beer, under£20` },
    { query: "3 pubs in Soho", context: { foodNeeds: [`with a ${venue} serving beer, under£20`] } },
    { query: "3 pubs in Soho", context: { foodNeeds: [`under£20, with a ${venue} serving beer`] } },
    { query: "3 pubs in Soho", context: { foodNeeds: [`with a ${venue} serving beer`, "pub route budget of£20"] } },
  ]))("keeps unpriced venue amenities independent from typed route totals: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const request = () => new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      });
      const prepared = await preparePlanGeneration(request(), PLAN_GENERATION_TEST_NOW);
      const response = await POST(request());
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(await response.json()).toMatchObject({ inferredContext: { budgetLimitPence: 2000 }, stops: expect.any(Array) });
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    "beer", "drinks", "real ale", "cider", "soft drinks", "mixed drinks and food",
    "locally brewed craft beverages", "pizza", "beer and pizza", "beer plus pizza", "beer & pizza",
  ].flatMap((object) => [
    "", "each ", "all ", "both ", "one ", "two ", "three ", "each regularly ", "all currently ",
    "with a garden ", "with a sunny terrace ", "with two bars ", "with a kitchen ", "with a restaurant ", "with a rooftop ", "with 2 bars ", "with a shed ",
    "with an outdoor area regularly ", "with a terrace and a garden ",
  ].flatMap((antecedent) => {
    const amenity = `${antecedent}serving ${object}`;
    return [
      { query: `3 pubs in Soho ${amenity}, under£20 per person` },
      { query: `3 pubs in Soho, under£20 per person, ${amenity}` },
      ...[
        `${amenity}, under£20 per person`,
        `under£20 per person, ${amenity}`,
      ].filter((field) => field.length <= 40).map((field) => ({
        query: "3 pubs in Clapham", context: { foodNeeds: [field] },
      })),
      ...(amenity.length <= 40 ? [
        { query: "3 pubs in Clapham", context: { foodNeeds: [amenity, "under£20 per person"] } },
        { query: "3 pubs in Clapham", context: { foodNeeds: ["under£20 per person", amenity] } },
      ] : []),
    ];
  })))("keeps venue serving predicates independent from route budgets: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      const lacksSoftDrinkEvidence = !('context' in input) && input.query.includes("soft drinks");
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status }, JSON.stringify(body))
        .toEqual({ preparation: 200, post: lacksSoftDrinkEvidence ? 422 : 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      if (lacksSoftDrinkEvidence) {
        expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
        expect(body.details.rejected.budgetEvidence).toBeGreaterThan(0);
      } else {
        expect(body.inferredContext.budgetLimitPence).toBe(2000);
        expect(body.stops).toHaveLength(3);
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    ...["about", "approximately", "at least", "roughly"].flatMap((qualifier) => [
      `one serving weighing ${qualifier} 200g under£10`,
      `£10 for one serving weighing ${qualifier} 200g`,
      `£10 pint at X&a serving weighing ${qualifier} 200g`,
      `pint at X&a serving weighing ${qualifier} 200g £10`,
    ]),
    "One pub in Soho, one serving weighing 200g under£10",
    "One pub in Soho, £10 for one serving weighing 200g",
    "£10 for the serving weighing 200g",
    "one serving enough for two under£10",
    "£10 for a freshly prepared serving weighing 200g",
    "with a serving weighing 200g under£10",
    "£10 for half a serving suitable for sharing",
    "£10 for a 200g serving weighing 200g",
    "a freshly prepared generous serving weighing 200g under£10",
    ...["weighing 200g", "enough for two", "suitable for sharing", "with friends"].flatMap((modifier) =>
      ["a serving", "servings", "two servings", "2 servings", "half a serving", "2/3 servings", "a generous serving", "each serving"].flatMap((noun) => {
        const food = `${noun} ${modifier}`;
        return [
          `${food} under£10`, `£10 for ${food}`,
          ...[" and ", " plus ", "+", "&"].flatMap((join) => [
            `£10 pint${join}${food}`, `pint${join}${food} £10`,
            `£10 ${food}${join}pint`, `${food}${join}pint £10`,
            ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((location) => [
              `£10 pint ${location} X${join}${food}`, `pint ${location} X${join}${food} £10`,
            ]),
          ]),
        ];
      })),
  ].flatMap((phrase) => [
    { query: phrase.includes("Soho") ? phrase : `3 pubs in Clapham, ${phrase}` },
    ...(phrase.length <= 40 ? [{ query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } }] : []),
  ]))("preserves purchased serving modifiers before paid work: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    ...[
      "One pub in Soho, one serving to share under£10",
      "£10 for a serving to share",
      "£10 pint at pub and a serving to share",
      "One pub in Soho, £10 for servings to share",
      "One pub in Soho, servings to share under£10",
    ].map((query) => ({ query })),
    ...[
      "One serving under£10 in Soho", "£10 for one serving in Soho",
      "Two servings under£10 in Soho", "£10 for two servings in Soho",
      "serving under£10", "£10 serving", "servings under£10", "£10 servings",
      "one serving 10 pounds", "one serving for 10 quid", "10 pounds for a serving",
      "one serving priced under£10", "one serving costs£10", "£10 PINT AND A SERVING",
      ...["a serving", "two servings", "half a serving", "2/3 servings"].flatMap((food) => [
        `${food} under£10`, `£10 for ${food}`,
        ...[" and ", " plus ", "+", "&"].flatMap((join) => [
          `£10 pint${join}${food}`, `pint${join}${food} under£10`,
          `£10 ${food}${join}pint`, `${food}${join}pint under£10`,
          `£10 pint at pub${join}${food}`, `pint at pub${join}${food} under£10`,
        ]),
      ]),
      ...["in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((modifier) => [
        `£10 pint ${modifier} X and a serving`, `pint ${modifier} X and a serving £10`,
      ]),
      ...["to share", "for two", "for the table"].flatMap((modifier) => [
        `One pub in Soho, one serving ${modifier} under£10`,
        ...["in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((location) => [
          `£10 pint ${location} X & a serving ${modifier}`,
          `pint ${location} X & a serving ${modifier} £10`,
        ]),
        ...["a serving", "servings", "two servings", "2 servings", "half a serving", "2/3 servings", "a generous serving"].flatMap((noun) => {
          const food = `${noun} ${modifier}`;
          return [
            `${food} under£10`, `£10 for ${food}`,
            ...[" and ", " plus ", "+", "&"].flatMap((join) => [
              `£10 pint${join}${food}`, `pint${join}${food} under£10`,
              `£10 ${food}${join}pint`, `${food}${join}pint under£10`,
              `£10 pint at pub${join}${food}`, `pint at pub${join}${food} under£10`,
            ]),
          ];
        }),
      ]),
    ].flatMap((phrase) => [
      { query: phrase.includes("Soho") ? phrase : `3 pubs in Clapham, ${phrase}` },
      ...(phrase.length <= 40 ? [{ query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } }] : []),
    ]),
  ])("refuses priced generic serving nouns before paid work: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    ...["beer", "drinks", "real ale", "mixed drinks and food", "craft beverages"].flatMap((object) => [
      "", "each ", "each regularly ", "with a garden ", "with a sunny terrace regularly ",
      "with a terrace and a garden ",
    ].flatMap((antecedent) => [
      `£5 pint ${antecedent}serving ${object}`, `pint under£5 ${antecedent}serving ${object}`,
      ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((location) => [
        `£5 pint ${location} X ${antecedent}serving ${object}`, `pint ${location} X under£5 ${antecedent}serving ${object}`,
      ]),
    ])),
    "£5 pint at pub serving pizza", "pint under£5 at pub serving pizza",
    "£5 pint serving pizza", "pint under£5 serving pizza",
    "pint under £ 5 serving pizza", "pint under5 pounds serving pizza", "pint under5 quid serving pizza",
    "£5 pint at pub serving hot pizza", "£5 pint at pub serving a pizza",
    "£5 pint at pub serving 2 pizzas", "£5 pint at pub serving food",
    "£5 pint at Beer and Burger serving pizza",
    "£5 pint at pub serves pizza", "£5 pint at pub with pizza",
    "£5 pint; a serving later", "£5 pint, servings afterwards",
    ...["to share", "for two", "for the table"].flatMap((modifier) => [
      `£5 pint serving pizza ${modifier}`, `£5 pint at X serving pizza ${modifier}`,
      `£5 pint; a serving ${modifier} later`,
    ]),
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}, pub route budget of£20` },
    { query: `3 pubs in Clapham, pub route budget of£20, ${phrase}` },
    ...(phrase.length <= 40 ? [
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase, "pub route budget of£20"] } },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pub route budget of£20", phrase] } },
    ] : []),
  ]))("keeps serving verbs and unpriced serving preferences separate from drink caps: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      const body = await response.json();
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.stops).toHaveLength(3);
      const venues = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
      const evidence = await planPriceEvidenceForVenues(await venues.loadConciergeVenues("london"), PLAN_GENERATION_TEST_NOW);
      for (const { venue } of prepared.prepared.candidates) {
        const price = evidence.get(venue.id)!;
        expect(priceEvidenceUsableForCeiling(price)).toBe(true);
        expect(price.pence).toBeLessThanOrEqual(500);
      }
      for (const stop of body.stops) {
        for (const candidate of [stop, ...stop.alternatives]) {
          const price = evidence.get(candidate.venueId)!;
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(500);
          expect(candidate.estimatedPintPricePence).toBe(price.pence);
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["a serving", "servings", "two servings", "a generous serving"].flatMap((noun) =>
    ["to share", "for two", "for the table", "with friends", "weighing 200g", "enough for two"].flatMap((modifier) => {
      const food = `${noun} ${modifier} later`;
      return [
        { query: `3 pubs in Clapham, ${food}, under£20 per person` },
        { query: `3 pubs in Clapham, under£20 per person, ${food}` },
        { query: "3 pubs in Clapham", context: { foodNeeds: [food, "under£20 per person"] } },
        { query: "3 pubs in Clapham", context: { foodNeeds: ["under£20 per person", food] } },
      ];
    }),
  ))("keeps complete later serving preferences independent from route budgets: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error("Expected a pub route");
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      const body = await response.json();
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.stops).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    "One slice under £10 in Soho", "One portion under £10 in Soho",
    "£10 for one slice in Soho", "£10 for one portion in Soho",
    "2 slices under £10 in Soho", "2 portions under £10 in Soho",
  ].flatMap((phrase) => [
    { query: phrase },
    { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } },
  ]))("refuses priced food servings with unspecified items: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect("response" in prepared ? prepared.response.status : 200).toBe(422);
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each([
    ...[
      "a serving of chips", "fish and chips", "a cheese and tomato pizza",
      "two generous servings of chips", "a bowl of fish and chips", "half a cheese and tomato pizza",
      "one and a half servings of chips", "2/3 of fish and chips", "a large pub fish and chips",
      "cheese & tomato pizza", "cheese+tomato pizza", "cheese plus tomato pizza",
      "a burger and chips", "chips and pizza",
    ].flatMap((food) => [
      `£10 ${food}`, `${food} under£10`,
      ...[" and ", " plus ", "+", "&"].flatMap((join) => [
        `£10 pint${join}${food}`, `pint${join}${food} under£10`,
        `£10 ${food}${join}pint`, `${food}${join}pint under£10`,
        `£10 pint at pub${join}${food}`, `pint at pub${join}${food} under£10`,
        `£10 beer, ${food}${join}pint`,
      ]),
    ]),
    ...["in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((modifier) =>
      [" and ", " plus ", "+", "&"].flatMap((join) => ["a serving of chips", "fish and chips", "cheese and tomato pizza"].flatMap((food) => [
        `£10 pint ${modifier} X${join}${food}`, `pint ${modifier} X${join}${food} £10`,
      ]))),
    "£10 PINT AND A SERVING OF CHIPS", "£10 PINT & FISH AND CHIPS",
    "£10 PINT AT PUB AND A CHEESE AND TOMATO PIZZA",
    "pub route budget of£20 for pint and a serving of chips",
    "route total£20 pint at pub&fish and chips",
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    ...(phrase.length <= 40 ? [{ query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } }] : []),
  ]))("retains complete coordinated food phrases at preparation and POST: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    ...[" and ", " plus ", "+", "&"].flatMap((join) => [
      "a slice of pizza", "a portion of chips", "1/2 a pizza", "two small pizzas",
      "a large pub meal", "a bowl of curry", "a plate of chips", "half a pub pizza",
      "one and a half pizzas", "2/3 of a pizza", "a hot burger",
    ].flatMap((food) => [
      { phrase: `£10 pint at X${join}${food}`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `pint at X${join}${food} £10`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    ])),
    ...["in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((modifier) =>
      [" and ", " plus ", "+", "&"].flatMap((join) => ["slice of pizza", "a hot burger", "1/2 pub meal"].flatMap((food) => [
        { phrase: `£10 pint ${modifier} X${join}${food}`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
        { phrase: `pint ${modifier} X${join}${food} £10`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      ]))),
    { phrase: "£10 pint at pub and a slice of pizza", code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    ...["Cock and Bottle", "Rose and Crown", "Beer and Burger", "Lamb & Flag", "Fox plus Hounds", "Cock&Bottle", "Beer+Burger", "The Bread and Beer"].flatMap((venue) => [
      { phrase: `£5 pint at ${venue}`, code: null },
      { phrase: `pint at ${venue} under£5`, code: null },
      { phrase: `£5 pint at ${venue} with food`, code: null },
      { phrase: `£5 pint at ${venue} serving pizza`, code: null },
      { phrase: `£10 pint at ${venue} and a hot burger`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `pint at ${venue}&a slice of pizza £10`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `pint at ${venue} with pizza priced under£10`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    ]),
  ].flatMap(({ phrase, code }) => [
    { input: { query: `3 pubs in Clapham, ${phrase}` }, code },
    ...(phrase.length <= 40 ? [{ input: { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } }, code }] : []),
  ]))("retains complete location subjects: %j", async ({ input, code }) => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), now);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      expect({ preparation: "prepared" in prepared ? 200 : prepared.response.status, post: response.status, code: body.code ?? null })
        .toEqual({ preparation: code ? 422 : 200, post: code ? 422 : 200, code });
      if (code) {
        if (!("response" in prepared)) throw new Error("Expected meal limitation");
        expect((await prepared.response.json()).code).toBe(code);
        expect(body.code).toBe(code);
        expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
        expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
      } else {
        if (!("prepared" in prepared)) throw new Error("Expected preparation");
        expect(prepared.prepared.context.budgetLimitPence).toBeNull();
        expect(body.inferredContext.budgetLimitPence).toBeNull();
        expect(body.stops).toHaveLength(3);
        const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
        const evidence = await planPriceEvidenceForVenues(await actual.loadConciergeVenues("london"), now);
        for (const { venue } of prepared.prepared.candidates) {
          const price = evidence.get(venue.id)!;
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(500);
        }
        for (const stop of body.stops) {
          for (const candidate of [stop, ...stop.alternatives]) {
            const price = evidence.get(candidate.venueId)!;
            expect(priceEvidenceUsableForCeiling(price)).toBe(true);
            expect(price.pence).toBeLessThanOrEqual(500);
            expect(candidate.estimatedPintPricePence).toBe(price.pence);
          }
        }
      }
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    ...["priced under£10", "under£10", "for £10"].flatMap((price) => [
      { phrase: `pint at pub with pizza ${price}`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `pizza at pub ${price}`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `pint at pub serving pizza ${price}`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    ]),
    ...["Rose and Crown", "Hare plus Hounds", "Fox & Hounds"].flatMap((venue) => [
      { phrase: `£5 for a pint at ${venue} serving pizza`, typed: `£5 pint at ${venue} with food`, code: null },
      { phrase: `pint at ${venue} under£5`, code: null },
      { phrase: `£5 pint at ${venue}`, code: null },
      { phrase: `pizza at ${venue} priced under£10`, typed: `pizza at ${venue} under£10`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `£10 pizza at ${venue}`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `pizza at ${venue} for £10`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
      { phrase: `£5 pint at ${venue} and a pizza`, code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    ]),
    { phrase: "£10 for a pint from the pub and a pizza", code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    { phrase: "£10 pint from pub&half a pizza", code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    { phrase: "£10 half a pizza at pub", code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    { phrase: "pint at pub and half a pizza under£10", code: "MEAL_CONSTRAINTS_UNSUPPORTED" },
    { phrase: "£5 pint at pubs with pizza", code: null },
  ].flatMap(({ phrase, code, ...rest }) => [
    { input: { query: `3 pubs in Clapham, ${phrase}` }, code },
    ...(("typed" in rest ? rest.typed ?? phrase : phrase).length <= 40
      ? [{ input: { query: "3 pubs in Clapham", context: { foodNeeds: ["typed" in rest ? rest.typed ?? phrase : phrase] } }, code }]
      : []),
  ]))("preserves original location price ownership: %j", async ({ input, code }) => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), now);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      expect({ preparation: "prepared" in prepared ? 200 : prepared.response.status, post: response.status }, JSON.stringify(body))
        .toEqual({ preparation: code ? 422 : 200, post: code ? 422 : 200 });
      if (code) {
        if (!("response" in prepared)) throw new Error("Expected meal limitation");
        expect((await prepared.response.json()).code).toBe(code);
        expect(body.code).toBe(code);
        expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
        expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
      } else {
        if (!("prepared" in prepared)) throw new Error("Expected preparation");
        expect(prepared.prepared.context.budgetLimitPence).toBeNull();
        expect(body.inferredContext.budgetLimitPence).toBeNull();
        expect(body.stops).toHaveLength(3);
        const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
        const evidence = await planPriceEvidenceForVenues(await actual.loadConciergeVenues("london"), now);
        for (const { venue } of prepared.prepared.candidates) {
          const price = evidence.get(venue.id)!;
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(500);
        }
        for (const stop of body.stops) {
          for (const candidate of [stop, ...stop.alternatives]) {
            const price = evidence.get(candidate.venueId)!;
            expect(priceEvidenceUsableForCeiling(price)).toBe(true);
            expect(price.pence).toBeLessThanOrEqual(500);
            expect(candidate.estimatedPintPricePence).toBe(price.pence);
          }
        }
      }
    } finally {
      clock.mockRestore();
    }
  });
  it.each([
    ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((modifier) => [
      `£10 pint ${modifier} pub and pizza`,
      `pints under£10 ${modifier} pub and pizza`,
      `pint ${modifier} pub and pizza under£10`,
      `route total£20 pint ${modifier} pub&pizza`,
    ]),
    "£10 for a pint from the pub and a pizza",
    "pints under£10 from pubs and pizza",
    "£10 pint from the pub and a pizza",
    "£10 for a pint from the pub and half a pizza",
    "£10 pint from pub&half a pizza",
    "£10 pint from pub&pub lunch",
    "£10 half a pizza from pub&pint",
    "route total£20 pint from pub&pub lunch",
    "£10 for a pint from the pub and a pub lunch",
    "a pint from the pub and a pizza under£10",
    "route total£20 for a pint from the pub and a pizza",
    "pub route budget of£20 for drinks from the pub and a pizza",
    "£10 for a pizza and a pint from the pub",
    "£10 for beer from the pub, a pizza and a pint",
    "£10 FOR A PINT FROM THE PUB & A PIZZA",
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    ...(phrase.length <= 40 ? [{ query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } }] : []),
  ]))("refuses coordinated meals across venue modifiers: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({ preparation: "response" in prepared ? prepared.response.status : "prepared", post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each([
    "£20 for three pub meals", "£20 for half a pub pizza", "£20 for a large portion of pub food",
    "£10 for beer, a pub lunch and a pint", "£10 for a pint & a large pub burger",
    "pints under£5 from pubs; pizza under£10", "£5 pint near pubs, pizza under£10",
    "route total£20 from pubs; pizza £10", "£10 for half a pub pizza and a pint",
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } },
  ]))("preserves food modifiers beside venue transitions: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect("response" in prepared ? prepared.response.status : 200).toBe(422);
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each([
    ...["soup", "a soup", "pasta", "tacos", "a taco", "burritos", "a burrito"].flatMap((food) => [
      `${food} under £10`, `£10 for ${food}`, `${food} and a pint under £10`,
      `£10 for a pint and ${food}`, `pints under £5 and ${food} under £10`,
    ]).flatMap((phrase) => [
      { query: `One pub in Soho, ${phrase}`, context: { stopCount: 1 } },
      { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [phrase] } },
    ]),
    ...[
      "pints under £5 and pizza afterwards under £10", "pints under £5 and a £10 pizza afterwards",
      "pints under £5 and soup later for £10", "pints under £5 & tacos later under £10",
    ].flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}` },
      ...(phrase.length <= 40 ? [{ query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } }] : []),
    ]),
  ])("keeps explicitly priced meal subjects ahead of drink and route budgets: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({ preparation: "response" in prepared ? prepared.response.status : 200, post: response.status })
      .toEqual({ preparation: 422, post: 422 });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each(["pub lunch", "pub meal", "pub food", "pub burger", "bar lunch", "bar meal", "bar food", "bar burger"].flatMap((subject) => [
    `under £20 for a ${subject}`,
    `pubs under£20 for a ${subject}`,
    `£20 for a ${subject}`,
    `a ${subject} under£20`,
    `£10 for a pint and a ${subject}`,
    `£10 for a ${subject} and a pint`,
    `a pint and a ${subject} under£10`,
    `a ${subject} and a pint under£10`,
    `£10 for a pint & a large ${subject}`,
    `£10 for beer, a ${subject} and a pint`,
    `£10 FOR A PINT AND A ${subject.toUpperCase()}`,
  ]).flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    { query: `3 pubs in Clapham ${phrase}` },
    { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } },
  ]))("refuses complete priced food subjects at preparation and POST: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({
      preparation: "response" in prepared ? prepared.response.status : "prepared",
      post: response.status,
    }).toEqual({ preparation: 422, post: 422 });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each([
    ...[
      ["pizza afterwards", "pints under £5, under £20 per person"],
      ["pizza afterwards", "pints under £5", "under £20 per person"],
      ["under £20 per person", "pints under £5", "pizza afterwards"],
      ["pizza afterwards", "pints under £5, under £20 each"],
    ].map((foodNeeds) => ({
      query: "3 pubs in Clapham", context: { foodNeeds }, total: 2000, ceiling: 500,
    })),
    ...[
      "a serving of chips", "fish and chips", "cheese and tomato pizza", "burger and chips",
      "fish plus chips", "fish+chips", "fish&chips", "cheese+tomato pizza",
    ].flatMap((food) => [
      ...["with", "serving", "serves"].flatMap((predicate) => [
        { query: `3 pubs in Clapham, £5 pint at Cock and Bottle ${predicate} ${food}`, total: null, ceiling: 500 },
        { query: `3 pubs in Clapham, pint at Beer and Burger under£5 ${predicate} ${food}`, total: null, ceiling: 500 },
        { query: `3 pubs in Clapham, pint at Cock and Bottle under£5 ${predicate} ${food}, under £20 per person`, total: 2000, ceiling: 500 },
        { query: "3 pubs in Clapham", context: { foodNeeds: [`£5 pint at X ${predicate} ${food.replaceAll(" and ", "&")}`] }, total: null, ceiling: 500 },
        { query: `3 pubs in Clapham, £5 pint at Cock and Bottle ${predicate} ${food}, route total£20`, total: 2000, ceiling: 500 },
      ]),
      { query: `3 pubs in Clapham, pints under£5, under£20 per person, ${food} later`, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham under£20 per person", context: { foodNeeds: [`£5 per pint, ${food.replaceAll(" and ", "&")} later`] }, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [food, "pints under£5", "pub route budget of£20"] }, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pub route budget of£20", "pints under£5", food] }, total: 2000, ceiling: 500 },
      { query: `3 pubs in Clapham under£20 per person with ${food} afterwards`, total: 2000, ceiling: null },
    ]),
    ...["with", "serving"].flatMap((amenity) => [
      { query: `3 pubs in Clapham, £5 pint at pub ${amenity} pizza, under£20 per person`, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [`£5 pint at X ${amenity} pizza, pub total£20`] }, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [`pint at X under£5 ${amenity} pizza,under£20`] }, total: 2000, ceiling: 500 },
    ]),
    ...[
      "pint of beer from pubs under 5 pounds",
      "pint of beer near pubs under 5 quid",
      "5 pounds for a pint of beer from pubs",
      "5 quid for a pint of beer near pubs",
    ].flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: null, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: null, ceiling: 500 },
    ]),
    ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by", "where"].flatMap((modifier) => [
      { phrase: `£5 for a pint of beer ${modifier} pubs serving pizza`, typed: `£5 pint of beer ${modifier} pubs with food` },
      { phrase: `pint of beer ${modifier} pubs under£5`, typed: `pint of beer ${modifier} pubs under£5` },
      { phrase: `pint of beer under£5 ${modifier} pubs serving pizza`, typed: `pint of beer under£5 ${modifier} pubs` },
    ].flatMap(({ phrase, typed }) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: null, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [typed] }, total: null, ceiling: 500 },
    ])),
    ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by"].flatMap((preposition) =>
      ["pubs serving pizza", "bars serving lunch"].flatMap((amenity) => [
        { phrase: `£5 for a pint ${preposition} ${amenity}`, typed: `£5 for a pint ${preposition} ${amenity}`, total: null, ceiling: 500 },
        { phrase: `pints under£5 ${preposition} ${amenity}`, typed: `pints under£5 ${preposition} ${amenity}`, total: null, ceiling: 500 },
        { phrase: `pub route budget of£20 for drinks ${preposition} ${amenity}`, typed: `pub total£20 ${preposition} ${amenity}`, total: 2000, ceiling: null },
        { phrase: `£5 for beer and a pint ${preposition} ${amenity}`, typed: `£5 beer&pint ${preposition} ${amenity}`, total: null, ceiling: 500 },
      ]).flatMap(({ phrase, typed, ...expected }) => [
        { query: `3 pubs in Clapham, ${phrase}`, ...expected },
        { query: "3 pubs in Clapham", context: { foodNeeds: [typed] }, ...expected },
      ])),
    ...[
      { phrase: "£5 for a pint where food is served", total: null, ceiling: 500 },
      { phrase: "pints under£5 where food is served", total: null, ceiling: 500 },
      { phrase: "route total£20 from pubs serving pizza", total: 2000, ceiling: null },
      { phrase: "route total£20 where food is served", total: 2000, ceiling: null },
      { phrase: "£5 beer&pint where food is served", total: null, ceiling: 500 },
      ...["pubs serving pizza", "bars serving lunch", "pubs serving food"].flatMap((amenity) => [
        { phrase: `route total£20 for 3 ${amenity}`, total: 2000, ceiling: null },
        { phrase: `under£20 for three ${amenity}`, total: 2000, ceiling: null },
      ]),
    ].flatMap(({ phrase, ...expected }) => [
      { query: `3 pubs in Clapham, ${phrase}`, ...expected },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, ...expected },
    ]),
    ...["at", "in", "from", "near", "around", "within", "inside", "outside", "by"].flatMap((preposition) => [
      { query: `3 pubs in Clapham, £5 for a pint ${preposition} pubs where food is served`, total: null, ceiling: 500 },
      { query: `3 pubs in Clapham, pints under£5 ${preposition} pubs where food is served`, total: null, ceiling: 500 },
      { query: `3 pubs in Clapham, route total£20 ${preposition} pubs where food is served`, total: 2000, ceiling: null },
    ]),
    ...["lunch", "food", "pizza"].flatMap((food) => ["pubs", "bars"].flatMap((venue) => ["at", "in"].flatMap((preposition) => [
      `£5 for a pint ${preposition} ${venue} serving ${food}`,
      `pints under£5 ${preposition} ${venue} serving ${food}`,
    ]))).flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: null, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: null, ceiling: 500 },
    ]),
    ...["pub lunch", "pub meal", "pub food", "pub burger"].flatMap((subject) => [
      `pubs under£20 with ${subject} afterwards`,
      `pubs under£20, ${subject} later`,
      `${subject}, route budget of£20`,
    ]).flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: 2000, ceiling: null },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: 2000, ceiling: null },
    ]),
    ...["lunch", "food", "pizza"].flatMap((food) => [
      { query: `3 pubs in Clapham, pub route budget of£20 for drinks at pubs serving ${food}`, total: 2000, ceiling: null },
      { query: "3 pubs in Clapham", context: { foodNeeds: [`route budget of£20 at pubs serving ${food}`] }, total: 2000, ceiling: null },
      { query: "3 pubs in Clapham", context: { foodNeeds: [food, "pints under£5", "pub route budget of£20"] }, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pub route budget of£20", "pints under£5", food] }, total: 2000, ceiling: 500 },
    ]),
    ...[
      "£5 for a pint at pubs serving pizza", "pints under£5 at pubs serving pizza",
      "£5 for a pint at pubs serving food", "pints under£5 at pubs serving food",
      "£5 for a pint in pubs serving pizza", "pints under£5 in pubs serving pizza",
      "£5 for a pint with pizza afterwards", "pints under£5 with pizza afterwards",
      "£5 for a pint, pizza afterwards", "pints under£5, pizza afterwards",
    ].flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: null, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: null, ceiling: 500 },
    ]),
    ...[
      "route budget of£20 at pubs serving pizza", "route total£20 for drinks with pizza",
      "route budget of£20 with pizza afterwards", "route budget of£20 at pubs serving food",
    ].flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: 2000, ceiling: null },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: 2000, ceiling: null },
    ]),
    ...["food", "pizza"].map((food) => ({
      query: `3 pubs in Clapham, pub route budget of£20 for drinks at pubs serving ${food}`,
      total: 2000, ceiling: null,
    })),
    ...[" and ", " plus ", " & ", "&"].flatMap((join) => ["afterwards", "later"].flatMap((qualifier) =>
      ["pizza", "a pizza", "fish and chips", "soup", "tacos"].map((food) => `pints under£5${join}${food} ${qualifier}`)))
      .concat(["£5 for a pint and pizza afterwards", "£5 pints and a burrito later", "pints under£5 and pasta afterwards"])
      .flatMap((phrase) => [
        { query: `3 pubs in Clapham, ${phrase}`, total: null, ceiling: 500 },
        { query: `3 pubs in Clapham, ${phrase}, under£20 per person`, total: 2000, ceiling: 500 },
        ...(phrase.length <= 40 ? [
          { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: null, ceiling: 500 },
          { query: "3 pubs in Clapham", context: { foodNeeds: [phrase, "pub route budget of£20"] }, total: 2000, ceiling: 500 },
        ] : []),
      ]),
    ...[
      "pints under£5 and pub route budget£20", "pints under£5 & route total£20",
      "pints under£5 plus pub budget of£20", "pub route budget£20 and pints under£5",
      "pints under£5 and under£20 per person", "under£20 per person and pints under£5",
    ].flatMap((phrase) => [
      { query: `3 pubs in Clapham, ${phrase}`, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] }, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase] }, total: 2000, ceiling: 500 },
    ]),
    ...["soup", "pasta", "tacos", "a burrito"].flatMap((food) => [
      { query: `3 pubs in Clapham with ${food} afterwards, under £20 per person`, total: 2000, ceiling: null },
      { query: `3 pubs in Clapham, pints under£5, under£20 per person, ${food} later`, total: 2000, ceiling: 500 },
      { query: "3 pubs in Clapham", context: { foodNeeds: [food, "pints under£5", "pub route budget of£20"] }, total: 2000, ceiling: 500 },
    ]),
  ])("keeps price subjects separate from venue food preferences: %j", async ({ total, ceiling, ...input }) => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
      const venues = await actual.loadConciergeVenues("london");
      loadConciergeVenuesMock.mockResolvedValueOnce(venues);
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), now);
      loadConciergeVenuesMock.mockResolvedValueOnce(venues);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      expect({ preparation: "prepared" in prepared ? 200 : prepared.response.status, post: response.status }, JSON.stringify(body))
        .toEqual({ preparation: 200, post: 200 });
      if (!("prepared" in prepared)) throw new Error(JSON.stringify(await prepared.response.json()));
      expect(prepared.prepared.context.budgetLimitPence).toBe(total);
      expect(body.inferredContext.budgetLimitPence).toBe(total);
      expect(body.stops).toHaveLength(3);
      const evidence = await planPriceEvidenceForVenues(venues, now);
      for (const { venue } of prepared.prepared.candidates) {
        const price = evidence.get(venue.id)!;
        if (ceiling !== null) {
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(ceiling);
        }
      }
      for (const [index, stop] of body.stops.entries()) {
        for (const candidate of [stop, ...stop.alternatives]) {
          if (ceiling !== null) {
            const price = evidence.get(candidate.venueId)!;
            expect(priceEvidenceUsableForCeiling(price)).toBe(true);
            expect(price.pence).toBeLessThanOrEqual(ceiling);
            expect(candidate.estimatedPintPricePence).toBe(price.pence);
          }
          if (total !== null) {
            const route = body.stops.map((selected: { venueId: string }, position: number) => position === index ? candidate : selected);
            expect(route.reduce((sum: number, selected: { venueId: string }) => sum + evidence.get(selected.venueId)!.pence!, 0)).toBeLessThanOrEqual(total);
          }
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["group of four", "party of four", "group of 4"].flatMap((group) => [
    { query: `3 pubs in Clapham for a ${group} under£20 per person` },
    { query: `3 pubs in Clapham for a ${group} under£20 per person`, context: { foodNeeds: ["pizza"] } },
  ]))("keeps non-drink group budgets through preparation and POST: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      if (!("prepared" in prepared)) throw new Error(JSON.stringify(await prepared.response.json()));
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(prepared.prepared.context.groupSize).toBe(4);
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.budgetSummary).toMatchObject({ limitPence: 2000, withinLimit: true });
      expect(body.stops).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    "slice of pizza", "a slice of pizza", "slice of a pizza", "a portion of chips", "two portions of chips",
    "half a pizza", "1/2 a pizza", "quarter of a pizza", "one and a half portions of chips",
    "three large slices of pizza", "a freshly baked pizza", "a cheese and tomato pizza",
    "a serving of pizza", "a generous serving of pizza",
    ...["three", "3", "four", "ten", "a dozen"].flatMap((quantity) => [
      `${quantity} portions of chips`, `${quantity} slices of pizza`,
    ]),
  ].flatMap((subject) => [
    `${subject} under£5`, `£5 for ${subject}`,
  ]).flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    { query: "3 pubs in Clapham", context: { foodNeeds: [phrase] } },
    ...(phrase.length + 6 <= 40 ? [{ query: "3 pubs in Clapham", context: { foodNeeds: [`pubs, ${phrase}`] } }] : []),
  ]))("keeps non-drink portions under meal refusal: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect({
      preparation: "response" in prepared ? prepared.response.status : "prepared",
      post: response.status,
    }).toEqual({ preparation: 422, post: 422 });
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    if (!("response" in prepared)) throw new Error("Expected meal limitation");
    expect(prepared.response.status).toBe(422);
    expect(await prepared.response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each([
    { query: "3 pubs in Clapham under£20 per person with four slices of pizza afterwards" },
    { query: "3 pubs in Clapham, under£20 per person, three portions of chips later" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pubs under£20, 3 portions of chips later"] } },
    { query: "3 pubs in Clapham, under£20 per person, pints under£5, ten portions of chips later" },
    { query: "3 pubs in Clapham under£20 per person", context: { foodNeeds: ["£5 per pint, ten portions of chips later"] } },
    { query: "3 pubs in Clapham under£20 per person with half a pizza afterwards" },
    { query: "3 pubs in Clapham, under£20 per person, three large slices of pizza later" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pubs under£20, half a pizza later"] } },
    { query: "3 pubs in Clapham under£20 per person", context: { foodNeeds: ["£5 per pint, half a pizza later"] } },
    { query: "3 pubs in Clapham, under£20 with half a pizza afterwards" },
    { query: "3 pubs in Clapham, under£20, half a pizza later" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["under£20 with half a pizza afterwards"] } },
  ])("preserves route and drink budgets with unpriced food quantities: %j", async (input) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), PLAN_GENERATION_TEST_NOW);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      if (!("prepared" in prepared)) throw new Error(JSON.stringify(await prepared.response.json()));
      expect(prepared.prepared.context.budgetLimitPence).toBe(2000);
      expect(body.inferredContext.budgetLimitPence).toBe(2000);
      expect(body.budgetSummary).toMatchObject({ limitPence: 2000, withinLimit: true });
      expect(body.stops).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(unsupportedServingSubjects)("retains complete raw serving spans: %s", (subject) => {
    const [before] = planPriceAmounts(`${subject} under£5`);
    expect(before).toMatchObject({ pence: 500, routeBudget: null, drink: { beforeStart: 0, afterEnd: null, supported: false } });
    const [after] = planPriceAmounts(`£5 for ${subject}`);
    expect(after).toMatchObject({ pence: 500, routeBudget: null, drink: { beforeStart: null, afterEnd: ` for ${subject}`.length, supported: false } });
  });

  it.each([
    ...["at", "in", "from", "near", "where"].flatMap((modifier) =>
      ["two pints", "half a pint", "bottle of beer", "pint of cider", "330ml beer"].flatMap((subject) => [
        `£5 ${subject} ${modifier} pubs`,
        `${subject} ${modifier} pubs under£5`,
      ])),
    "330ml beers under£5", "£5 for a 330ml beer",
    "330 ml beers under£5", "£5 for a 330 ml beer",
    "33cl beers under£5", "£5 for a 33cl beer",
    "33 cl beers under£5", "£5 for a 33 cl beer",
    "0.33L beers under£5", "£5 for a 0.33L beer",
    "0.33 L beers under£5", "£5 for a 0.33 L beer",
    "0,33 L beers under£5", "£5 for a 0,33 L beer",
    "beers 330ml under£5", "£5 for a beer 330ml",
    "two 330ml beers under£5", "£5 for two 330ml beers",
    "2 bottles of beer under£5", "£5 for 2 bottles of beer",
    "pub route budget of£20 for 330ml beers", "pub route budget of£20 for two beers",
    ...unsupportedServingSubjects.flatMap((subject) => [`${subject} under£5`, `£5 for ${subject}`]),
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase] } },
  ]))("refuses complete serving qualifiers before paid consumption: %j", async (input) => {
    const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
    expect("response" in prepared ? prepared.response.status : 200).toBe(422);
    if (!("response" in prepared)) throw new Error("Expected unsupported serving refusal");
    expect(await prepared.response.json()).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });

  it.each([
    ...[
      ...["drinks", "beers", "pints"].flatMap((item) => [
        { budget: `pub route budget of£5 for ${item}`, total: 500 },
        { budget: `pub route budget of£20 for ${item}`, total: 2000 },
      ]),
      ...[
        "route budget of£20 for drinks", "crawl budget of£20 for beers", "pub budget of£20 for pints",
        "total budget of£20 for drinks", "per-person budget of£20 for beers",
        "route budget of£20 per person for drinks", "pub route budget of£20 each for pints",
        "pub route budget under£20 for beers", "route total of£20 for drinks",
      ].map((budget) => ({ budget, total: 2000 })),
      { budget: "pub route budget of£20 for drinks, pub route budget of£15 per person", total: 1500 },
      { budget: "pub route budget of£15 per person, pub route budget of£20 for drinks", total: 1500 },
    ].flatMap(({ budget, total }) => [
      { query: `3 pubs in Clapham, ${budget}, pints under£5`, total },
      { query: `3 pubs in Clapham, pints under£5, ${budget}`, total },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", ...budget.split(", "), "pints under£5"] }, total },
      { query: "3 pubs in Clapham", context: { foodNeeds: ["pints under£5", ...budget.split(", "), "pizza"] }, total },
    ]),
    { query: "3 pubs in Clapham, pub route budget of£20 for drinks, pints under£5, under£15 per person", total: 1500 },
    { query: "3 pubs in Clapham, under£15 per person, pints under£5, pub route budget of£20 for drinks", total: 1500 },
    { query: "3 pubs in Clapham, pub route budget of£20 for drinks", context: { foodNeeds: ["pizza", "pub route budget of£15 for beers", "pints under£5"] }, total: 1500 },
    { query: "3 pubs in Clapham, pub route budget of£15 for beers, pints under£5", context: { foodNeeds: ["pizza", "pub route budget of£20 for drinks"] }, total: 1500 },
    { query: "3 pubs in Clapham, pub route budget of£15 for beers", context: { budgetLimitPence: 1200, foodNeeds: ["pizza", "pints under£5"] }, total: 1200 },
  ])("preserves explicit route ownership before drink rates: %j", async ({ total, ...input }) => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
      const venues = await actual.loadConciergeVenues("london");
      loadConciergeVenuesMock.mockResolvedValueOnce(venues);
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), now);
      loadConciergeVenuesMock.mockResolvedValueOnce(venues);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      const body = await response.json();
      if (total === 500) {
        expect(response.status).toBe(422);
        expect(body).toMatchObject({ code: "GROUNDED_CONSTRAINTS_UNSATISFIED" });
      } else {
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.inferredContext.budgetLimitPence).toBe(total);
        expect(body.budgetSummary).toMatchObject({ limitPence: total, withinLimit: true });
        expect(body.stops).toHaveLength(3);
        expect(body.stops.reduce((sum: number, stop: { estimatedPintPricePence: number }) => sum + stop.estimatedPintPricePence, 0)).toBeLessThanOrEqual(total);
        const evidence = await planPriceEvidenceForVenues(venues, now);
        const stops = body.stops.flatMap((stop: { venueId: string; alternatives: Array<{ venueId: string }> }) => [stop, ...stop.alternatives]);
        expect(stops.length).toBeGreaterThan(3);
        for (const stop of stops) {
          const price = evidence.get(stop.venueId)!;
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(500);
          expect(stop.estimatedPintPricePence).toBe(price.pence);
        }
        for (const [index, stop] of body.stops.entries()) {
          for (const alternative of stop.alternatives) {
            const route = body.stops.map((selected: { venueId: string }, position: number) => position === index ? alternative : selected);
            expect(route.reduce((sum: number, selected: { venueId: string }) => sum + evidence.get(selected.venueId)!.pence!, 0)).toBeLessThanOrEqual(total);
          }
        }
      }
      if (!("prepared" in prepared)) throw new Error(JSON.stringify(await prepared.response.json()));
      expect(prepared.prepared.context.budgetLimitPence).toBe(total);
      const candidateEvidence = await planPriceEvidenceForVenues(venues, now);
      expect(prepared.prepared.candidates.length).toBeGreaterThan(3);
      for (const { venue } of prepared.prepared.candidates) {
        const price = candidateEvidence.get(venue.id)!;
        expect(priceEvidenceUsableForCeiling(price)).toBe(true);
        expect(price.pence).toBeLessThanOrEqual(500);
        expect(venue.cheapestPrice).toBe(price.pence! / 100);
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each(drinkRatePhrases(5).flatMap(drinkRateInputs))(
    "enforces every accepted drink price through preparation and selection: %j", async ({ total, ...input }) => {
      const now = Date.parse("2026-10-15T12:00:00Z");
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
        const venues = await actual.loadConciergeVenues("london");
        loadConciergeVenuesMock.mockResolvedValueOnce(venues);
        const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
          method: "POST", body: JSON.stringify(input),
        }), now);
        if (!("prepared" in result)) throw new Error(JSON.stringify(await result.response.json()));
        expect(result.prepared.context.budgetLimitPence).toBe(total);
        const evidence = await planPriceEvidenceForVenues(venues, now);
        expect(result.prepared.candidates.length).toBeGreaterThan(3);
        for (const { venue } of result.prepared.candidates) {
          expect(priceEvidenceUsableForCeiling(evidence.get(venue.id)!)).toBe(true);
          expect(evidence.get(venue.id)!.pence).toBeLessThanOrEqual(500);
          expect(venue.cheapestPrice).toBe(evidence.get(venue.id)!.pence! / 100);
        }
        loadConciergeVenuesMock.mockResolvedValueOnce(venues);
        const response = await POST(new Request("http://localhost/api/plans/generate", {
          method: "POST", body: JSON.stringify(input),
        }));
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.inferredContext.budgetLimitPence).toBe(total);
        expect(body.stops).toHaveLength(3);
        const stops = body.stops.flatMap((stop: { venueId: string; alternatives: Array<{ venueId: string }> }) => [stop, ...stop.alternatives]);
        expect(stops.length).toBeGreaterThan(3);
        for (const stop of stops) {
          const price = evidence.get(stop.venueId)!;
          expect(priceEvidenceUsableForCeiling(price)).toBe(true);
          expect(price.pence).toBeLessThanOrEqual(500);
          expect(stop.estimatedPintPricePence).toBe(price.pence);
          if (total !== null) expect(stop.priceEvidence).toEqual(price);
        }
        if (total !== null) {
          expect(body.budgetSummary).toMatchObject({ limitPence: total, withinLimit: true });
          for (const [index, stop] of body.stops.entries()) {
            for (const alternative of stop.alternatives) {
              const route = body.stops.map((selected: { venueId: string }, position: number) => position === index ? alternative : selected);
              expect(route.reduce((sum: number, selected: { venueId: string }) => sum + evidence.get(selected.venueId)!.pence!, 0)).toBeLessThanOrEqual(total);
            }
          }
        }
      } finally {
        clock.mockRestore();
      }
    },
  );

  it.each(drinkRatePhrases(1).flatMap(drinkRateInputs))(
    "refuses impossible drink prices through selection: %j", async ({ total, ...input }) => {
      const now = Date.parse("2026-10-15T12:00:00Z");
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
        const response = await POST(new Request("http://localhost/api/plans/generate", {
          method: "POST", body: JSON.stringify(input),
        }));
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({ code: total === null ? "GROUNDED_VENUES_INSUFFICIENT" : "GROUNDED_CONSTRAINTS_UNSATISFIED" });
      } finally {
        clock.mockRestore();
      }
    },
  );

  it.each([
    { query: "3 pubs in Clapham, beers under£6", context: { foodNeeds: ["pizza", "£5 per drink"] } },
    { query: "3 pubs in Clapham, £5 per drink", context: { foodNeeds: ["pizza", "beers under£6"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", "beers under£6", "£5 per drink"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", "£5 per drink", "beers under£6"] } },
  ])("retains conflicting drink ceilings across representations: %j", async (input) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error(JSON.stringify(await result.response.json()));
    expect(result.prepared.context.budgetLimitPence).toBeNull();
    expect(result.prepared.candidates.map(({ venue }) => venue.name).sort()).toEqual(["Effra Social", "Feeley's", "The Beehive"]);
  });

  it.each(["beer", "drink", "pint"].flatMap((item) => [
    `pizza and a ${item} under£10`, `${item} and pizza under£10`,
    `£10 for a ${item} and pizza`, `£10 for pizza and a ${item}`,
    `PIZZA & ${item.toUpperCase()} UNDER£10`, `pizza, beer and ${item} under£10`,
    `route budget of£10 for a ${item} and pizza`,
    `total budget of£10 for pizza and a ${item}`,
  ]).concat([
    "pizza and a pint of beer under£10", "pint of beer and pizza under£10",
    "£10 for a pint of beer and pizza", "£10 for pizza and a pint of beer",
    "PIZZA & PINT OF BEER UNDER£10", "pizza, beer and pint of beer under£10",
    "route total£10 for pint of beer & pizza", "route total£10 for pizza & pint of beer",
  ]).flatMap((phrase) => [
    { query: `One ${phrase} in Soho`, context: { stopCount: 1 } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [phrase] } },
  ]))("retains meal bundle ownership for every drink alias: %j", async (input) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    "bottles under£5", "£5 for a bottle", "cocktails under£5", "£5 per cocktail",
    "half pints under£5", "£5 per half-pint", "bottled beers under£5", "£5 for two beers",
    "two pints under£5", "£5 per can", "cans under£5", "£5 per glass",
    "bottles of beer under£5", "beer bottles under£5", "£5 for a beer bottle",
    "£5 for a bottle of beer", "glasses under£5", "shots under£5", "£5 for a shot",
  ].flatMap((phrase) => [
    { query: `3 pubs in Clapham, ${phrase}` },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", phrase] } },
  ]))("explicitly refuses unsupported drink servings: %j", async (input) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    { drinkCategory: "wine" }, { drinkCategory: "cocktail" }, { zeroProof: true },
  ])("does not substitute pint prices for a selected drink rate: %j", async (context) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "3 pubs in Clapham, drinks under£5", context }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "DRINK_PRICE_CONSTRAINTS_UNSUPPORTED" });
  });

  it.each([
    { query: "3 pubs in Clapham, beers under£5", context: { foodNeeds: ["pizza"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", "beers under£5"] } },
    { query: "3 pubs in Clapham, £1 for a beer", context: { foodNeeds: ["pizza"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["pizza", "£1 for a beer"] } },
  ])("keeps drink rates separate from totals: %j", async (input) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error(JSON.stringify(await result.response.json()));
    expect(result.prepared.context.budgetLimitPence).toBeNull();
    if (JSON.stringify(input).includes("£1")) expect(result.prepared.candidates).toHaveLength(0);
    else expect(result.prepared.candidates.map(({ venue }) => venue.name).sort()).toEqual(["Effra Social", "Feeley's", "The Beehive"]);
  });

  it.each([
    { query: "One pub in Soho. Steak with a budget of £20", context: { stopCount: 1 } },
    { query: "One pub in Soho, steak with a budget of £20", context: { stopCount: 1 } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["pubs, steak with a budget of £20"] } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["pubs", "steak with a budget of £20"] } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["pints", "under £5"] } },
    { query: "One pub in Soho. Steak with a budget of£20", context: { stopCount: 1 } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["pubs; steak with a budget of £20"] } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["pubs; steak with a budget of£20"] } },
  ])("refuses meal budgets across independent clauses: %j", async (input) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(isLimitedMock.mock.calls.some(([key]) => key === paidSpendBudgetKey("plan-generate"))).toBe(false);
  });

  it.each([
    { query: "3 pubs in Clapham, under £5 for a pint, pizza afterwards" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["£5 for a pint, pizza afterwards"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["under £5 for a pint, pizza afterwards"] } },
  ])("keeps independently priced pints separate from later food: %j", async (input) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error(JSON.stringify(await result.response.json()));
    expect(result.prepared.context.budgetLimitPence).toBeNull();
    expect(result.prepared.candidates.map(({ venue }) => venue.name).sort()).toEqual(["Effra Social", "Feeley's", "The Beehive"]);
  });

  it.each([
    { query: "3 pubs in Clapham", foodNeeds: ["pizza", "pints under£1"], total: null },
    { query: "3 pubs in Clapham", foodNeeds: ["salad, pub route budget of£5"], total: 500 },
    { query: "3 pubs in Clapham, pints under£5, under£20 per person", foodNeeds: ["pizza", "pints under£1"], total: 2000 },
    { query: "3 pubs in Clapham, under£20 per person", foodNeeds: ["salad, pub route budget of£5"], total: 500 },
  ])("enforces structured limits through generation: %j", async ({ query, foodNeeds, total }) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query, context: { foodNeeds } }),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error(JSON.stringify(await result.response.json()));
    expect(result.prepared.context.budgetLimitPence).toBe(total);
    if (foodNeeds.some((value) => value.includes("pints"))) expect(result.prepared.candidates).toHaveLength(0);
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query, context: { foodNeeds } }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: total === null ? "GROUNDED_VENUES_INSUFFICIENT" : "GROUNDED_CONSTRAINTS_UNSATISFIED" });
  });

  it.each([
    { query: "3 pubs in Clapham", foodNeeds: ["salad, pub route budget of£15", "pints under£5"], total: 1500 },
    { query: "3 pubs in Clapham, under£20 per person, pints under£6", foodNeeds: ["salad, pub route budget of£15", "pints under£5"], total: 1500 },
    { query: "3 pubs in Clapham, under£15 per person, pints under£5", foodNeeds: ["salad, pub route budget of£20", "pints under£6"], total: 1500 },
  ])("retains strictest structured limits on returned stops and alternatives: %j", async ({ query, foodNeeds, total }) => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
      const venues = await actual.loadConciergeVenues("london");
      loadConciergeVenuesMock.mockResolvedValueOnce(venues);
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify({ query, context: { foodNeeds } }),
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(body.inferredContext.budgetLimitPence).toBe(total);
      expect(body.budgetSummary).toMatchObject({ limitPence: total, withinLimit: true });
      expect(body.stops).toHaveLength(3);
      const evidence = await planPriceEvidenceForVenues(venues, now);
      const stops = body.stops.flatMap((stop: { venueId: string; alternatives: Array<{ venueId: string }> }) => [stop, ...stop.alternatives]);
      expect(stops.length).toBeGreaterThan(3);
      for (const stop of stops) {
        const price = evidence.get(stop.venueId);
        expect(price).toBeDefined();
        expect(priceEvidenceUsableForCeiling(price!)).toBe(true);
        expect(price!.pence).toBeLessThanOrEqual(500);
      }
      for (const [index, stop] of body.stops.entries()) {
        for (const alternative of stop.alternatives) {
          const route = body.stops.map((selected: { venueId: string }, position: number) => position === index ? alternative : selected);
          expect(route.reduce((sum: number, selected: { venueId: string }) => sum + evidence.get(selected.venueId)!.pence!, 0)).toBeLessThanOrEqual(total);
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    "pints priced under £5", "pints costing under £5", "pints for under £5",
    "under £5 for a pint", "pints priced under 5 pounds", "pints costing under 5 quid",
    "pints for under£5", "under£5 for a pint", "pints priced under £5,00",
  ].flatMap((rate) => [
    `3 pubs in Clapham, under £20 per person, ${rate}`,
    `3 pubs in Clapham, ${rate}, under £20 per person`,
  ]))("binds independently priced pint clauses: %s", (query) => {
    expect(planPriceLimits(query)).toEqual({ pintCeiling: 5, routeBudgetPence: 2000 });
    expect(inferNightContext(query).context.budgetLimitPence).toBe(2000);
  });

  it.each([
    "One steak in Soho with a budget of £20",
    "steak and a budget of £20",
    "salad under£10", "curry under£10",
    "salad and a pint under£10", "a pint and salad under£10",
  ].flatMap((meal) => [
    { query: meal.includes("Soho") ? meal : `One ${meal} in Soho`, context: { stopCount: 1 } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [meal] } },
  ]).concat([
    ...["soup under£10", "soup and a pint under£10", "£10 for a pint and soup", "soup, beer and pint under£10"].map((food) => ({
      query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [food] },
    })),
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["under£10"] } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: ["pizza and a budget of £20 per person"] } },
  ]))("refuses unowned food amounts: %j", async (input) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
  });

  it.each([
    { query: "3 pubs in Clapham with salad and a budget of £20 per person" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["salad", "pints priced under£5"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["salad, pub route budget of £20"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["salad", "under £5 for a pint"] } },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["salad"] } },
  ])("preserves owned route and drink money with food preferences: %j", async (input) => {
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    expect(result).toHaveProperty("prepared");
  });

  it("excludes stale canonical evidence from standalone pint-cap candidates", async () => {
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "3 pubs in Clapham, maximum £5 per pint" }),
    }), Date.parse("2026-10-15T12:00:00Z"));
    if (!("prepared" in result)) throw new Error("Expected preparation before route selection");
    expect(result.prepared.context.budgetLimitPence).toBeNull();
    expect(result.prepared.candidates.map(({ venue }) => venue.name)).not.toContain("Junction (Clapham)");
    const evidence = await planPriceEvidenceForVenues(result.prepared.candidates.map(({ venue }) => venue), result.prepared.requestNow);
    for (const candidate of result.prepared.candidates) {
      expect(priceEvidenceUsableForCeiling(evidence.get(candidate.venue.id)!)).toBe(true);
      expect(evidence.get(candidate.venue.id)!.pence).toBeLessThanOrEqual(500);
    }
  });

  it.each([
    { query: "3 pubs in Clapham, maximum £5 per pint" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["maximum £5 per pint"] } },
  ])("keeps canonical pint ceilings on selected stops and alternatives: %j", async (input) => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const prepared = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }), now);
      expect(prepared).toHaveProperty("prepared");
      if (!("prepared" in prepared)) throw new Error("Expected cap preparation");
      expect(prepared.prepared.context.budgetLimitPence).toBeNull();
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST", body: JSON.stringify(input),
      }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.stops).toHaveLength(3);
      const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
      const evidence = await planPriceEvidenceForVenues(await actual.loadConciergeVenues("london"), now);
      const stops = body.stops.flatMap((stop: { venueId: string; alternatives: Array<{ venueId: string }> }) => [stop, ...stop.alternatives]);
      expect(stops.length).toBeGreaterThan(3);
      for (const stop of stops) {
        const price = evidence.get(stop.venueId);
        expect(price).toBeDefined();
        expect(priceEvidenceUsableForCeiling(price!)).toBe(true);
        expect(price!.pence).toBeLessThanOrEqual(500);
        expect(stop).toMatchObject({ estimatedPintPricePence: price!.pence, priceEvidence: price!, priceCategory: "beer", priceServing: "pint" });
      }
      for (const [position, stop] of body.stops.entries()) {
        for (const alternative of stop.alternatives) {
          const replacement = body.stops.map((selected: { venueId: string }, index: number) => index === position ? alternative : selected);
          expect(new Set(replacement.map((entry: { venueId: string }) => entry.venueId)).size).toBe(3);
          for (const entry of replacement) {
            expect(entry).toMatchObject({ priceEvidence: evidence.get(entry.venueId)!, priceCategory: "beer", priceServing: "pint" });
          }
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  it("uses canonical amounts rather than slim prices for a pint ceiling", async () => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      ...(await cappedTestVenues()).map((venue) => ({ ...venue, cheapestPrice: 0.01 })),
      generatedVenue("missing-canonical", { cheapestPrice: 0.01 }),
    ]);
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "3 pubs in Clapham, pints under £5" }),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error("Expected canonical price filtering");
    expect(result.prepared.candidates.map(({ venue }) => venue.name).sort()).toEqual(["Effra Social", "Feeley's", "The Beehive"]);
    expect(result.prepared.candidates.map(({ venue }) => venue.cheapestPrice).sort()).toEqual([2.89, 4.2, 4.7]);
  });

  it.each([
    { query: "3 pubs in Clapham, under £20 per person, pints under £5", total: 2000 },
    { query: "3 pubs in Clapham, pints under £5, under £20 per person", total: 2000 },
    { query: "3 pubs in Clapham, maximum £5 per pint", total: null },
    { query: "3 pubs in Clapham, under £15 per person, maximum £5 per pint", total: 1500 },
    { query: "3 pubs in Clapham, maximum £6 per pint, pints under £5", total: null },
    { query: "3 pubs in Clapham, pints under £5, maximum £6 per pint", total: null },
    { query: "3 pubs in Clapham, £5 per pint, under £20 per person", total: 2000 },
    { query: "3 pubs in Clapham, under £20 per person, £5 pints", total: 2000 },
    { query: "3 pubs in Clapham, under £20 per person, pints under £5.00", total: 2000 },
    { query: "3 pubs in Clapham, under £20 per person, pints priced under £5", total: 2000 },
    { query: "3 pubs in Clapham, pints priced under £5, under £20 per person", total: 2000 },
    { query: "3 pubs in Clapham, under £20 per person, pints costing under £5", total: 2000 },
    { query: "3 pubs in Clapham, pints costing under £5, under £20 per person", total: 2000 },
    { query: "3 pubs in Clapham, under £20 per person, pints for under £5", total: 2000 },
    { query: "3 pubs in Clapham, pints for under £5, under £20 per person", total: 2000 },
    { query: "3 pubs in Clapham, under £20 per person, under £5 for a pint", total: 2000 },
    { query: "3 pubs in Clapham, under £5 for a pint, under £20 per person", total: 2000 },
    { query: "3 pubs in Clapham, pints costing under 5 quid, under 20 pounds per person", total: 2000 },
  ])("keeps pint rates separate from route totals: $query", async ({ query, total }) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query }),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error("Expected a prepared pub route");
    expect(result.prepared.context.budgetLimitPence).toBe(total);
    expect(result.prepared.candidates.map(({ venue }) => venue.name).sort()).toEqual(["Effra Social", "Feeley's", "The Beehive"]);
  });

  it.each([
    "One Sunday roast under £15 in Soho",
    "steak under £20 in Soho",
    "sandwich under £8 in Soho",
    "One Sunday roast and a pint under £15 in Soho",
    "£20 for a pint and a steak in Soho",
    "One pub in Soho with a sandwich priced under £8",
  ].flatMap((meal) => [
    { query: meal, context: { stopCount: 1 } },
    { query: "One pub in Soho", context: { stopCount: 1, foodNeeds: [meal.replace(/^One pub in Soho with /, "").replace(/ in Soho$/, "")] } },
  ]))("refuses unsupported priced meals through either input: %j", async (input) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
  });

  it.each([
    { query: "3 pubs in Clapham with pizza and a budget of £20 per person" },
    { query: "3 pubs in Clapham under £20 per person", context: { foodNeeds: ["pizza with a route budget of £20"] } },
  ])("preserves an explicit route budget with an unpriced food preference: %j", async (input) => {
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1"), generatedVenue("v2"), generatedVenue("v3"),
    ]);
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error("Expected an unpriced food preference with a route budget");
    expect(result.prepared.context.budgetLimitPence).toBe(2000);
    expect(result.prepared.candidates).toHaveLength(3);
  });

  it.each([
    { query: "One vegan meal under £10 in Soho" },
    { query: "One meal under 500 calories in Soho" },
    { query: "One pizza under £10 in Soho" },
    { query: "3 pubs" },
    { query: "" },
    { query: "3 pubs in Soho", cityId: "not-a-city" },
    { query: "3 pubs in Soho", cityId: "manchester" },
    { intake: generationIntake({ area: { kind: "night-patch", id: "hackney" } }) },
  ])("keeps the paid slot available after a deterministic refusal: %j", async (input) => {
    vi.stubEnv("PUBMAX_PAID_SPEND_BUDGET_PLAN_GENERATE", "1");
    let paidCalls = 0;
    isLimitedMock.mockImplementation(async (key, _durableKey, limit) =>
      key === paidSpendBudgetKey("plan-generate") ? ++paidCalls > (limit ?? 0) : false);
    const rejected = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(paidCalls).toBe(0);
    expect(isLimitedMock.mock.calls[0]?.[0]).toMatch(/^plan-generate:/);
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1"), generatedVenue("v2"), generatedVenue("v3"),
    ]);
    const valid = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "3 pubs in Clapham" }),
    }), PLAN_GENERATION_TEST_NOW);
    expect(valid).toHaveProperty("prepared");
    expect(paidCalls).toBe(1);
    const spent = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "3 pubs in Clapham" }),
    }));
    expect(spent.status).toBe(429);
    expect(await spent.json()).toMatchObject({ code: "DAILY_BUDGET_SPENT" });
  });

  it.each([
    "One vegan meal under £10 and under 500 calories in Soho",
    "One meal under 500kcal in Soho",
    "One meal under 500calories in Soho",
    "One pizza under £10 in Soho",
    "One kebab under 10 pounds in Soho",
    "Chips under 5 quid in Soho",
    "One dish under £10 in Soho",
    "Food under £10 in Soho",
    "One pizza under £10 per person in Soho",
    "One pizza under £10 each at a pub in Soho",
    "One pizza in Soho under £10",
    "Find a meal in Soho for £10",
    "A £10 pizza in Soho",
    "Can I get a pizza in Soho under £10?",
    "3 pubs in Soho, pizza costs under £10",
    "One burger under £10 in Soho",
    "One pub in Soho with pizza priced under £10",
    "One pub in Soho with pizza in the evening under £10",
    "One pub in Soho with food priced under £10",
    "One pub in Soho with pizza under £10 and pints under £5",
    "One pub in Soho with a £10.50 burger",
    "One pub in Soho with a 10,50 quid burger",
    "One pizza and a pint under £10 in Soho",
    "One pint and a pizza under £10 in Soho",
    "One pizza and one beer for £10 in Soho",
    "One pizza in Soho, priced under £10",
    "One pizza in Soho, under £10",
    "£10 for a pint and a pizza in Soho",
    "One pizza, a pint and a beer under £10 in Soho",
    "£10 for a pint, a pizza and a beer in Soho",
    "£10 for a pint & pizza in Soho",
    "One pizza & pint under £10 in Soho",
    "One pizza AND a pint under £10 in Soho",
    "£10 for a pint&pizza in Soho",
    "One pub with food&drinks under £10 in Soho",
  ])("refuses unsupported meal constraints in %s", async (query) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query,
        context: { stopCount: 1 },
      }),
    }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(body.error).toMatch(/meal.*dietary.*calorie/i);
    expect(body).not.toHaveProperty("stops");
  });

  it.each([
    { foodNeeds: ["under 500 calories"] },
    { foodNeeds: ["pizza under £10"] },
    { foodNeeds: ["kebab under 10 pounds"] },
    { foodNeeds: ["chips under 5 quid"] },
    { foodNeeds: ["vegan meal under £10 under 500 calories"] },
    { foodNeeds: ["meal under 500kcal"] },
    { foodNeeds: ["meal under 500calories"] },
    { foodNeeds: ["burger under £10"] },
    { foodNeeds: ["pub with pizza priced under £10"] },
    { foodNeeds: ["pub with pizza in the evening under £10"] },
    { foodNeeds: ["with food priced under £10"] },
    { foodNeeds: ["pizza under £10 and pints under £5"] },
    { foodNeeds: ["dish under £10"] },
    { foodNeeds: ["food under £10"] },
    { foodNeeds: ["pizza under £10 per person"] },
    { foodNeeds: ["pizza, under £10 per person"] },
    { foodNeeds: ["pizza under £10 each at a pub"] },
    { foodNeeds: ["pizza in Soho under £10"] },
    { foodNeeds: ["meal in Soho for £10"] },
    { foodNeeds: ["£10 pizza"] },
    { foodNeeds: ["pubs, pizza costs under £10"] },
    { foodNeeds: ["£10.50 burger"] },
    { foodNeeds: ["10,50 quid burger"] },
    { foodNeeds: ["One pizza and a pint under £10"] },
    { foodNeeds: ["One pint and a pizza under £10"] },
    { foodNeeds: ["One pizza and one beer for £10"] },
    { foodNeeds: ["One pizza in Soho, priced under £10"] },
    { foodNeeds: ["One pizza in Soho, under £10"] },
    { foodNeeds: ["£10 for a pint and a pizza"] },
    { foodNeeds: ["pizza, a pint and a beer under £10"] },
    { foodNeeds: ["£10 for a pint, a pizza and a beer"] },
    { foodNeeds: ["£10 for a pint & pizza"] },
    { foodNeeds: ["pizza & pint under £10"] },
    { foodNeeds: ["pizza AND a pint under £10"] },
    { foodNeeds: ["£10 for a pint&pizza"] },
    { foodNeeds: ["with food&drinks under £10"] },
  ])("refuses unsupported structured food constraints: %j", async (context) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "One pub in Soho", context: { stopCount: 1, ...context } }),
    }));
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
    expect(body.error).toMatch(/meal.*dietary.*calorie/i);
    expect(body).not.toHaveProperty("stops");
  });

  it.each([
    { query: "3 pubs in Clapham with food, under £20 per person", foodNeeds: ["food"] },
    { query: "3 pubs in Clapham with food, under £20 each, maximum £5 per pint", foodNeeds: ["food"] },
    { query: "3 pubs in Clapham with food, under 20 pounds per person", foodNeeds: ["food"] },
    { query: "3 pubs in Clapham with pizza afterwards, under £20 per person", foodNeeds: ["pizza"] },
    { query: "3 pubs in Clapham under £20 per person with pizza afterwards", foodNeeds: ["pizza"] },
    { query: "3 pubs in Clapham with food, budget of £20", foodNeeds: ["food"] },
    { query: "3 pubs in Clapham with food under £20", foodNeeds: ["food"] },
    { query: "3 pubs in Clapham with roast afterwards, under £20 per person", foodNeeds: [] },
    { query: "3 pubs in Clapham with steak afterwards, under £20 per person", foodNeeds: [] },
    { query: "3 pubs in Clapham with sandwich afterwards, under £20 per person", foodNeeds: [] },
  ])("preserves food amenities and drink budgets: $query", async ({ query, foodNeeds }) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(query.includes("per pint") ? await cappedTestVenues() : [
      generatedVenue("v1"), generatedVenue("v2"), generatedVenue("v3"),
    ]);
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query }),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error(`Expected a prepared food-aware pub route: ${JSON.stringify({ query, response: await result.response.json() })}`);
    expect(result.prepared.context.foodNeeds).toEqual(foodNeeds);
    expect(result.prepared.candidates).toHaveLength(3);
  });

  it.each([
    "with food, under £20 per person",
    "serving food under £20",
    "pizza afterwards, under £20 per person",
    "£20 per person with pizza afterwards",
    "pizza, maximum £5 per pint",
    "pizza under £5 per pint",
    "pizza with pints under £5",
    "pizza with £5 pints",
    "pizza with £5 for a pint",
    "food under £5 per pint",
    "pizza, pints priced under £5",
    "pizza, pints costing under £5",
    "pizza, pints for under £5",
    "pizza, under £5 for a pint",
    "pizza and a pint, pints under £5",
    "pint and pizza later, pints under £5",
  ].flatMap((foodNeed) => [
    { source: "query", query: `3 pubs in Clapham, under £20 per person, maximum £5 per pint, ${foodNeed}`, foodNeeds: undefined },
    { source: "foodNeeds", query: "3 pubs in Clapham, under £20 per person, maximum £5 per pint", foodNeeds: [foodNeed] },
  ]))("preserves drink budgets with $source: $query $foodNeeds", async ({ query, foodNeeds }) => {
    loadConciergeVenuesMock.mockResolvedValueOnce(await cappedTestVenues());
    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({
        query,
        context: foodNeeds ? { foodNeeds } : undefined,
      }),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in result)) throw new Error(`Expected a prepared food-aware pub route: ${JSON.stringify({ query, foodNeeds, response: await result.response.json() })}`);
    expect(result.prepared.context.budgetLimitPence).toBe(2000);
    expect(result.prepared.context.foodNeeds).toEqual(foodNeeds ?? [query.includes("pizza") ? "pizza" : "food"]);
    expect(result.prepared.candidates.map(({ venue }) => venue.name).sort()).toEqual(["Effra Social", "Feeley's", "The Beehive"]);
  });

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

  it("joins trusted wine prices into value ranking without using pint prices", async () => {
    // The dataset stamp is 13:00 London, so the distance weight is two and
    // the cheaper corroborated wine leads.
    const result = await prepareWineValueSearch(PLAN_GENERATION_TEST_NOW);

    expect("prepared" in result).toBe(true);
    if (!("prepared" in result)) return;
    expect(result.prepared.context.daypart).toBe("daytime");
    expect(categoryIndexMock).toHaveBeenCalledWith(expect.arrayContaining(["wine"]), PLAN_GENERATION_TEST_NOW);
    expect(result.prepared.candidates.map((candidate) => candidate.venue.id)).toEqual(["v2", "v1", "v3"]);
    expect(result.prepared.candidates[0]?.reasons).toContain("corroborated community wine price £7.00");
    expect(result.prepared.candidates[0]?.reasons.join(" ")).not.toMatch(/pints from/i);
    expect(result.prepared.candidates[2]?.reasons.join(" ")).not.toMatch(/pints|£/i);
  });

  it("keeps trusted wine value ordering when the query requests after work in daytime", async () => {
    const result = await prepareWineValueSearch(
      PLAN_GENERATION_TEST_NOW,
      "cheap wine in Clapham for 2 after work",
    );

    expect("prepared" in result).toBe(true);
    if (!("prepared" in result)) return;
    expect(result.prepared.context).toMatchObject({ daypart: "after_work", drinkCategory: "wine" });
    expect(categoryIndexMock).toHaveBeenCalledWith(expect.arrayContaining(["wine"]), PLAN_GENERATION_TEST_NOW);
    expect(result.prepared.candidates.map((candidate) => candidate.venue.id)).toEqual(["v2", "v1", "v3"]);
    expect(result.prepared.candidates[0]?.reasons).toContain("corroborated community wine price £7.00");
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
    expect(result.prepared.candidates[0]?.reasons).toContain("corroborated community wine price £9.00");
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
    expect(result.prepared.candidates[0]?.reasons).toContain("corroborated community wine price £9.00");
  });

  it("prepares a zero-proof Soft drinks request with matching corroborated prices instead of Alcohol-free evidence", async () => {
    const now = Date.now();
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1"),
      generatedVenue("v2"),
      generatedVenue("v3"),
    ]);
    categoryIndexMock.mockResolvedValueOnce({
      prices: [
        { venueId: "v1", drinkCategory: "alcohol-free", priceGbp: 1, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v2", drinkCategory: "soft-drink", priceGbp: 3, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v3", drinkCategory: "soft-drink", priceGbp: 1, submittedAt: now, source: "community", corroborations: 1 },
      ],
      truncated: false,
      degraded: false,
    });

    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "cheap soft drinks in Clapham for 2", context: { zeroProof: true, drinkCategory: "soft-drink" } }),
    }), now);

    if (!("prepared" in result)) throw new Error("Expected prepared Soft drinks search");
    expect(result.prepared.context).toMatchObject({ drinkCategory: "soft-drink", zeroProof: true });
    expect(result.prepared.candidates[0]?.venue.id).toBe("v2");
    expect(result.prepared.candidates[0]?.selectedDrinkPrice).toMatchObject({ category: "soft-drink", priceGbp: 3 });
    for (const id of ["v1", "v3"]) {
      const candidate = result.prepared.candidates.find((row) => row.venue.id === id);
      expect(candidate?.selectedDrinkPrice).toBeNull();
      expect(candidate?.reasons.join(" ")).not.toMatch(/corroborated|pints from/i);
    }
  });

  it("generates Soft drinks stops from matching evidence while preserving zero-proof money guards", async () => {
    const now = Date.now();
    loadConciergeVenuesMock.mockResolvedValueOnce([1, 2, 3, 4].map((n) => generatedVenue(`v${n}`)));
    categoryIndexMock.mockResolvedValueOnce({
      prices: [
        { venueId: "v1", drinkCategory: "alcohol-free", priceGbp: 1, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v2", drinkCategory: "soft-drink", priceGbp: 3, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v3", drinkCategory: "soft-drink", priceGbp: 4, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v4", drinkCategory: "alcohol-free", priceGbp: 2, submittedAt: now, source: "community", corroborations: 2 },
      ],
      truncated: false,
      degraded: false,
    });

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "cheap soft drinks in Clapham for 2", context: { zeroProof: true, drinkCategory: "soft-drink", stopCount: 2 } }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({ drinkCategory: "soft-drink", zeroProof: true });
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId).sort()).toEqual(["v2", "v3"]);
    for (const stop of body.stops) {
      expect(stop.reason).toMatch(/corroborated.*soft drinks price/i);
      expect(stop.estimatedPintPricePence).toBeNull();
      expect(stop.priceEvidence).toBeNull();
      expect(stop.selectedDrinkPriceEvidence ?? null).toBeNull();
    }
    expect(body.budgetSummary).toMatchObject({ withinLimit: null, basis: "selected-drink-price-unavailable" });
  });

  it.each(["value", "standard", "treat"] as const)(
    "reports drinkCategory in contextEffects for a %s zero-proof Soft drinks request",
    async (budget) => {
      const now = Date.now();
      loadConciergeVenuesMock.mockResolvedValueOnce([1, 2, 3].map((n) => generatedVenue(`v${n}`)));
      categoryIndexMock.mockResolvedValueOnce({
        prices: [
          { venueId: "v2", drinkCategory: "soft-drink", priceGbp: 3, submittedAt: now, source: "community", corroborations: 2 },
        ],
        truncated: false,
        degraded: false,
      });

      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "soft drinks in Clapham for 2", context: { budget, zeroProof: true, drinkCategory: "soft-drink", stopCount: 2 } }),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.inferredContext).toMatchObject({ budget, drinkCategory: "soft-drink", zeroProof: true });
      expect(body.contextEffects).toEqual(expect.arrayContaining(["zeroProof", "drinkCategory"]));
    },
  );

  it.each([null, "beer", "wine", "gin"] as const)(
    "does not report drinkCategory in contextEffects for a value zero-proof %s request",
    async (drinkCategory) => {
      loadConciergeVenuesMock.mockResolvedValueOnce([1, 2, 3].map((n) => generatedVenue(`v${n}`)));

      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "cheap night in Clapham for 2", context: { budget: "value", zeroProof: true, drinkCategory, stopCount: 2 } }),
      }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.inferredContext).toMatchObject({ zeroProof: true, drinkCategory });
      expect(body.contextEffects).toContain("zeroProof");
      expect(body.contextEffects).not.toContain("drinkCategory");
    },
  );

  it("explains a value Soft drinks stop with one matching price reason and room for a second reason", async () => {
    const now = Date.now();
    loadConciergeVenuesMock.mockResolvedValueOnce([1, 2, 3, 4].map((n) => generatedVenue(`v${n}`, { hasStory: true })));
    categoryIndexMock.mockResolvedValueOnce({
      prices: [
        { venueId: "v1", drinkCategory: "alcohol-free", priceGbp: 1, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v2", drinkCategory: "soft-drink", priceGbp: 3, submittedAt: now, source: "community", corroborations: 2 },
        { venueId: "v3", drinkCategory: "soft-drink", priceGbp: 4, submittedAt: now, source: "community", corroborations: 2 },
      ],
      truncated: false,
      degraded: false,
    });

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "cheap soft drinks in a historic pub in Clapham for 2", context: { zeroProof: true, drinkCategory: "soft-drink", stopCount: 2 } }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inferredContext).toMatchObject({ budget: "value", drinkCategory: "soft-drink", zeroProof: true });
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId).sort()).toEqual(["v2", "v3"]);
    for (const stop of body.stops) {
      expect(stop.reason.match(/soft drinks price/gi)).toHaveLength(1);
      expect(stop.reason).toMatch(/corroborated community soft drinks price £\d\.\d{2}, historic character\.$/);
    }
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

  // DIETARY WORDS DEGRADE, MEAL PRICES REFUSE (launch review, 30 Oct 2026). A
  // dietary word used to refuse the whole plan. Now it plans, prefers pubs that
  // publish a menu link, and says in one line that nobody checked the menu.
  it.each([
    ["vegan pubs in Clapham for 2", "We can't check vegan menus or allergens."],
    ["halal food, 3 pubs in Clapham", "We can't check halal menus or allergens."],
    ["gluten-free, 3 pubs in Clapham", "We can't check gluten-free menus or allergens."],
    ["3 pubs in Clapham, one of us has a nut allergy", "We can't check nut-free menus or allergens."],
    ["3 pubs in Clapham, food allergies in the group", "We can't check menus for allergies."],
  ])("plans %s and warns once that the menu is unchecked", async (query, opening) => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    const dietary = body.planningConfidence.warnings.filter((warning: string) => warning.startsWith("We can't check"));
    expect(dietary).toHaveLength(1);
    expect(dietary[0].startsWith(`${opening} `)).toBe(true);
    expect(dietary[0]).toMatch(/(These stops publish a menu link\.|Some of these stops publish a menu link\.|Ask each pub before you order\.)/);
  });

  it("still refuses a meal price beside a dietary word", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "One vegan pizza under £10 in Clapham" }),
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "MEAL_CONSTRAINTS_UNSUPPORTED" });
  });

  it("plans a short walk between pubs and names a must-have it cannot meet", async () => {
    const walk = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "short walk between pubs in Clapham" }),
    }));
    expect(walk.status).toBe(200);

    const tight = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "short walk between pubs in Clapham, under £1 per person" }),
    }));
    expect(tight.status).toBe(422);
    const body = await tight.json();
    expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
    expect(body.error).toContain("£1");
    expect(body.error).not.toMatch(/walk/i);
  });

  it.each([
    ["degraded", false, true, "We could not read the wine prices just now, so none are shown yet."],
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
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-17T23:00:00.000Z"));
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
