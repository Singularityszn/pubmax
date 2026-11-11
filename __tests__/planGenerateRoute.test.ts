import { describe, expect, it, vi } from "vitest";

import {
  cappedTestVenues,
  categoryIndexMock,
  chargedPaidLane,
  drinkRateInputs,
  drinkRatePhrases,
  fetchWalkLegRouteMock,
  generatedVenue,
  generationIntake,
  GET,
  hashIp,
  inferNightContext,
  installPlanGenerateRouteHooks,
  isLimitedMock,
  loadConciergeVenuesMock,
  orsApiKeyMock,
  PLAN_GENERATION_TEST_NOW,
  planPriceEvidenceForVenues,
  planPriceLimits,
  POST,
  preparePlanGeneration,
  prepareWineValueSearch,
  priceEvidenceUsableForCeiling,
  verifyPlanGroundingProof,
  walkRouteStoreMock,
} from "./helpers/planGenerateRoute";
import { STALE_AFTER_DAYS } from "@/lib/priceConfidence";
import { DAY_MS } from "@/lib/dayMs";
import { priceRowReadDay } from "@/lib/priceReadDay.mjs";
import { groupVenuePrices } from "@/lib/venues";
import dataset from "@/public/data/pint_prices_app_dataset.json";
import type { LngLat } from "@/lib/walkRoute";

// POST /api/plans/generate: drink rates, pint ceilings, structured limits and
// the end-to-end route contract.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

  async function westEndVenues() {
    const actual = await vi.importActual<typeof import("@/lib/concierge/venues.server")>("@/lib/concierge/venues.server");
    const venues = await actual.loadConciergeVenues("london");
    const named = (name: string) => {
      const venue = venues.find((row) => row.name === name);
      if (!venue) throw new Error(`missing ${name}`);
      return venue;
    };
    return {
      soho: ["The Dog & Duck", "Coach & Horses", "The Crown & Two Chairmen", "The Nellie Dean", "Shakespeares Head (Soho)"].map(named),
      hercules: named("Hercules Pillars"),
      threeCrowns: named("Three Crowns (Picaddilly)"),
    };
  }

  async function generate(input: unknown) {
    const response = await POST(new Request("http://localhost/api/plans/generate", { method: "POST", body: JSON.stringify(input) }));
    return { status: response.status, body: await response.json() };
  }

  function offeredVenueIds(body: { stops: { venueId: string; alternatives: { venueId: string }[] }[]; endingRecommendations: { kind: string; options: { id: string }[] }[] }) {
    const extensions = body.endingRecommendations.find((ending) => ending.kind === "keep_going")?.options ?? [];
    return [...body.stops, ...body.stops.flatMap((stop) => stop.alternatives)].map(({ venueId }) => venueId)
      .concat(extensions.map(({ id }) => id));
  }

  it.each([
    { query: "Cheap pints in Soho for 3" },
    { query: "Cheap pints in Soho for 3", intake: generationIntake({ area: { kind: "night-patch", id: "soho" }, groupSize: 3 }) },
    { query: "Cheap pints in Soho for 3", context: { nightArea: "piccadilly-soho", areaFocus: "piccadilly" } },
  ])("keeps a Soho request's stops, alternatives and extra stops in Soho: %j", async (input) => {
    const { soho, hercules, threeCrowns } = await westEndVenues();
    loadConciergeVenuesMock.mockResolvedValueOnce([...soho, hercules, threeCrowns]);
    const { status, body } = await generate(input);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.inferredContext).toMatchObject({ nightArea: "piccadilly-soho", areaFocus: "soho" });
    expect(body.stops).toHaveLength(3);
    for (const id of offeredVenueIds(body)) expect(soho.map(({ id }) => id)).toContain(id);

    loadConciergeVenuesMock.mockResolvedValueOnce([...soho.slice(0, 2), hercules, threeCrowns]);
    const shortfall = await generate(input);
    // The honest shortfall names Soho and never pads from the rest of the area.
    expect(shortfall.status).toBe(422);
    expect(["GROUNDED_VENUES_INSUFFICIENT", "GROUNDED_CONSTRAINTS_UNSATISFIED"]).toContain(shortfall.body.code);
    expect(shortfall.body.details.availableVenueCount).toBe(2);
    expect(JSON.stringify(shortfall.body)).toContain("Soho");
    expect(JSON.stringify(shortfall.body)).not.toContain("Piccadilly");
  });

  it.each([
    { query: "Cheap pints in Piccadilly for 3" },
    { query: "Cheap pints in Piccadilly for 3", intake: generationIntake({ area: { kind: "night-patch", id: "soho" }, groupSize: 3 }) },
    { query: "Cheap pints in Piccadilly & Soho for 3" },
    { query: "Cheap pints in Piccadilly and Soho for 3", context: { nightArea: "piccadilly-soho", areaFocus: "soho" } },
    { context: { nightArea: "piccadilly-soho", groupSize: 3 } },
  ])("keeps Three Crowns for Piccadilly and whole-area requests: %j", async (input) => {
    const { soho, threeCrowns } = await westEndVenues();
    loadConciergeVenuesMock.mockResolvedValueOnce([...soho.slice(0, 2), threeCrowns]);
    const { status, body } = await generate(input);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.stops.map((stop: { venueId: string }) => stop.venueId)).toContain(threeCrowns.id);
  });

  it("keeps a Piccadilly request off Hercules Pillars", async () => {
    const { soho, hercules, threeCrowns } = await westEndVenues();
    loadConciergeVenuesMock.mockResolvedValueOnce([...soho, hercules, threeCrowns]);
    const { status, body } = await generate({ query: "Cheap pints in Piccadilly for 3" });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.inferredContext.areaFocus).toBe("piccadilly");
    expect(offeredVenueIds(body)).not.toContain(hercules.id);
  });

  it("keeps a locked Soho Plan in Soho when it regenerates", async () => {
    const { planSummaryGenerationBody } = await import("@/components/plan/PlanSummary");
    const { slidingDoorsGenerationBody } = await import("@/lib/slidingDoorsClient");
    const { cleanNightContext } = await import("@/lib/nightPlanning");
    const { soho, hercules, threeCrowns } = await westEndVenues();
    loadConciergeVenuesMock.mockResolvedValueOnce([...soho, hercules, threeCrowns]);
    const generated = await generate({ query: "Cheap pints in Soho for 3" });
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    // Locking stores the generated context through the same cleaner.
    const locked = {
      context: cleanNightContext(generated.body.inferredContext),
      plan: { anchorVenueId: null, anchorSource: null, startTime: "2026-11-11T19:00:00.000Z" },
      stops: generated.body.stops,
    } as unknown as import("@/lib/plan").PlanState;
    expect(locked.context?.areaFocus).toBe("soho");

    for (const body of [
      planSummaryGenerationBody(locked),
      slidingDoorsGenerationBody(locked, "shorter-walk"),
      slidingDoorsGenerationBody(locked, "plot-twist"),
    ]) {
      loadConciergeVenuesMock.mockResolvedValueOnce([...soho, hercules, threeCrowns]);
      const regenerated = await generate(body);
      expect(regenerated.status, JSON.stringify(regenerated.body)).toBe(200);
      expect(regenerated.body.inferredContext.areaFocus).toBe("soho");
      for (const id of offeredVenueIds(regenerated.body)) expect(soho.map(({ id }) => id)).toContain(id);
    }
  });

  it.each(drinkRatePhrases(5).flatMap(drinkRateInputs))(
    "enforces every accepted drink price through preparation and selection: %j", async ({ total, ...input }) => {
      const now = PLAN_GENERATION_TEST_NOW;
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
      const now = PLAN_GENERATION_TEST_NOW;
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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    const now = PLAN_GENERATION_TEST_NOW;
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

  it.each([
    { query: "3 pubs in Clapham, maximum £5 per pint" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["maximum £5 per pint"] } },
  ])("excludes stale canonical evidence from standalone pint-cap candidates: %j", async (input) => {
    const now = PLAN_GENERATION_TEST_NOW + (STALE_AFTER_DAYS + 1) * DAY_MS;
    const staleUnderCap = new Set(groupVenuePrices(dataset).filter((venue) => {
      return venue.cheapestPrice !== null && venue.cheapestPrice <= 5 && venue.prices.length > 0
        && venue.prices.every((row) => {
          const day = priceRowReadDay(row);
          return day !== null && now - Date.parse(`${day}T12:00:00Z`) > STALE_AFTER_DAYS * DAY_MS;
        });
    }).map((venue) => venue.id));
    expect(staleUnderCap.size).toBeGreaterThan(0);

    const fresh = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), PLAN_GENERATION_TEST_NOW);
    if (!("prepared" in fresh)) throw new Error("Expected fresh preparation before route selection");
    expect(fresh.prepared.candidates.some(({ venue }) => staleUnderCap.has(venue.id))).toBe(true);

    const result = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }), now);
    if (!("prepared" in result)) throw new Error("Expected preparation before route selection");
    expect(result.prepared.context.budgetLimitPence).toBeNull();
    expect(result.prepared.candidates.filter(({ venue }) => staleUnderCap.has(venue.id))).toEqual([]);
    const evidence = await planPriceEvidenceForVenues(result.prepared.candidates.map(({ venue }) => venue), result.prepared.requestNow);
    for (const candidate of result.prepared.candidates) {
      const price = evidence.get(candidate.venue.id)!;
      expect(price.source).not.toBeNull();
      expect(now - Date.parse(price.source!.observedAt)).toBeLessThanOrEqual(STALE_AFTER_DAYS * DAY_MS);
      expect(price.pence).toBeGreaterThan(0);
      expect(price.pence).toBeLessThanOrEqual(500);
    }
  });

  it.each([
    { query: "3 pubs in Clapham, maximum £5 per pint" },
    { query: "3 pubs in Clapham", context: { foodNeeds: ["maximum £5 per pint"] } },
  ])("keeps canonical pint ceilings on selected stops and alternatives: %j", async (input) => {
    const now = PLAN_GENERATION_TEST_NOW;
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
  ])("charges no paid lane on a deterministic refusal or a valid plan: %j", async (input) => {
    const rejected = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify(input),
    }));
    expect(rejected.status).toBeGreaterThanOrEqual(400);
    expect(isLimitedMock.mock.calls[0]?.[0]).toMatch(/^plan-generate:/);
    loadConciergeVenuesMock.mockResolvedValueOnce([
      generatedVenue("v1"), generatedVenue("v2"), generatedVenue("v3"),
    ]);
    const valid = await preparePlanGeneration(new Request("http://localhost/api/plans/generate", {
      method: "POST", body: JSON.stringify({ query: "3 pubs in Clapham" }),
    }), PLAN_GENERATION_TEST_NOW);
    expect(valid).toHaveProperty("prepared");
    expect(chargedPaidLane()).toBe(false);
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

  // Audit finding lib/paidSpendBudget:lane-ceiling-single-shared-allocation.
  // Plan generation calls no paid model, so a deployment-wide lane here
  // defended no spend: one address could spend it in about two hours and every
  // other planner caller, web and MCP, was refused for the rest of a rolling day.
  it("charges no paid lane, because plan generation calls no paid model", async () => {
    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.42" },
      body: JSON.stringify({ query: "A quiet night in Barnes" }),
    }));

    expect(response.status).toBe(200);
    expect(chargedPaidLane()).toBe(false);
  });

  it("keeps planning for a second address when every paid lane is spent", async () => {
    isLimitedMock.mockImplementation(async (key: string) => key.startsWith("paid-spend:"));

    for (const address of ["203.0.113.10", "198.51.100.20"]) {
      const response = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        headers: { "x-real-ip": address },
        body: JSON.stringify({ query: "A quiet night in Barnes" }),
      }));
      expect(response.status).toBe(200);
    }
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
    // Each request spends its own address bucket, and the buckets differ.
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

  it("returns an editable route with honest confidence for an unreviewed area", async () => {
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
        coverageStatus: "discovered",
        coverageScore: 0,
        missingEvidence: expect.arrayContaining(["opening_hours"]),
        routeReady: false,
        lastReviewedAt: null,
      },
    });
    expect(body.district).toMatchObject(body.nightArea);
    expect(body.planningConfidence.provenance.some((source: { kind: string }) => source.kind === "night_area_review")).toBe(false);
    expect(body.stops).toHaveLength(3);
    expect(body.stops.every((stop: { provenance: { kind: string }[] }) => stop.provenance.every((source) => source.kind !== "night_area_review"))).toBe(true);
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

  it("plans a £20 crawl inside its total, and names the cheapest route found when a crawl budget fits nothing", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(PLAN_GENERATION_TEST_NOW);
    try {
      const fits = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Clapham, a £20 crawl" }),
      }));
      expect(fits.status).toBe(200);
      const route = await fits.json();
      expect(route.inferredContext.budgetLimitPence).toBe(2000);
      expect(route.budgetSummary).toMatchObject({ limitPence: 2000, withinLimit: true });
      expect(route.budgetSummary.estimatedPerPersonPence).toBeLessThanOrEqual(2000);
      // Every stop carries the listed price and the day it was read.
      for (const stop of route.stops) {
        expect(stop.priceEvidence?.source?.observedAt).toEqual(expect.any(String));
      }

      const tight = await POST(new Request("http://localhost/api/plans/generate", {
        method: "POST",
        body: JSON.stringify({ query: "Clapham, a £5 crawl" }),
      }));
      expect(tight.status).toBe(422);
      const body = await tight.json();
      expect(body.code).toBe("GROUNDED_CONSTRAINTS_UNSATISFIED");
      const cheapest = body.details.cheapestRoute;
      expect(cheapest.stops).toHaveLength(3);
      expect(cheapest.totalPence).toBeGreaterThan(500);
      expect(cheapest.totalPence).toBe(cheapest.stops.reduce((sum: number, stop: { pricePence: number }) => sum + stop.pricePence, 0));
      expect(body.error).toContain("No 3-stop route in Clapham fits £5.00 for one listed pint at each stop.");
      expect(body.error).toContain(`The cheapest we found is £${(cheapest.totalPence / 100).toFixed(2)}`);
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
