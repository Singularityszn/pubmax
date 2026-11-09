import { describe, expect, it, vi } from "vitest";

import {
  chargedPaidLane,
  installPlanGenerateRouteHooks,
  loadConciergeVenuesMock,
  PLAN_GENERATION_TEST_NOW,
  planPriceEvidenceForVenues,
  POST,
  preparePlanGeneration,
  priceEvidenceUsableForCeiling,
} from "./helpers/planGenerateRoute";

// POST /api/plans/generate: food phrases, location subjects, venue modifiers and
// priced meal subjects.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    const now = PLAN_GENERATION_TEST_NOW;
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
        expect(chargedPaidLane()).toBe(false);
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
    const now = PLAN_GENERATION_TEST_NOW;
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
        expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
    expect(loadConciergeVenuesMock).not.toHaveBeenCalled();
  });
});
