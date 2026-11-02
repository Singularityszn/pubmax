import { describe, expect, it } from "vitest";

import {
  chargedPaidLane,
  installPlanGenerateRouteHooks,
  loadConciergeVenuesMock,
  PLAN_GENERATION_TEST_NOW,
  POST,
  preparePlanGeneration,
} from "./helpers/planGenerateRoute";

// POST /api/plans/generate: purchased serving modifiers and priced generic
// serving nouns are refused before paid work.
// The mocks, fixtures and hooks are shared in __tests__/helpers/planGenerateRoute.ts.
describe("POST /api/plans/generate", () => {
  installPlanGenerateRouteHooks();

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
    expect(chargedPaidLane()).toBe(false);
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
    expect(chargedPaidLane()).toBe(false);
  });
});
