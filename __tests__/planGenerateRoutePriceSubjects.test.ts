import { describe, expect, it, vi } from "vitest";

import {
  chargedPaidLane,
  installPlanGenerateRouteHooks,
  loadConciergeVenuesMock,
  PLAN_GENERATION_TEST_NOW,
  planPriceAmounts,
  planPriceEvidenceForVenues,
  POST,
  preparePlanGeneration,
  priceEvidenceUsableForCeiling,
  unsupportedServingSubjects,
} from "./helpers/planGenerateRoute";

// POST /api/plans/generate: price subjects beside food preferences, group
// budgets, food quantities, serving spans and route ownership before drink rates.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

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
    const now = PLAN_GENERATION_TEST_NOW;
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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
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
    const now = PLAN_GENERATION_TEST_NOW;
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
});
