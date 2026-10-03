import { describe, expect, it } from "vitest";

import { parsePlanGenerationRequest } from "@/lib/planGenerationRequest";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function request(body: unknown): Request {
  return new Request("http://test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("parsePlanGenerationRequest", () => {
  it("treats an explicit null legacy context like an omitted context when intake is absent", async () => {
    const omitted = await parsePlanGenerationRequest(request({ query: "Clapham classics" }), NOW);
    const explicitNull = await parsePlanGenerationRequest(
      request({ query: "Clapham classics", context: null }),
      NOW,
    );

    expect(explicitNull).toEqual(omitted);
    expect(explicitNull).toEqual({
      ok: true,
      value: {
        query: "Clapham classics",
        context: null,
        cityId: null,
        intake: null,
        hasIntake: false,
        operationKey: null,
        anchor: null,
      },
    });
  });

  it.each([
    ["a string", "clapham"],
    ["an array", []],
    ["an unknown key", { unknown: true }],
    ["an invalid known value", { groupSize: 0 }],
    ["a non-boolean wetherspoonsPreferred", { wetherspoonsPreferred: "yes" }],
    ["an unknown drink category", { drinkCategory: "spirits" }],
  ])("still rejects non-null malformed context: %s", async (_label, context) => {
    const result = await parsePlanGenerationRequest(request({ query: "Clapham classics", context }), NOW);

    expect(result).toEqual({
      ok: false,
      code: "MALFORMED_REQUEST",
      message: "Night Context is invalid.",
      status: 400,
    });
  });

  it("allowlists wetherspoonsPreferred as a boolean Night Context field", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "Spoons in Clapham", context: { wetherspoonsPreferred: true } }),
      NOW,
    );

    expect(result).toEqual({
      ok: true,
      value: {
        query: "Spoons in Clapham",
        context: { wetherspoonsPreferred: true },
        cityId: null,
        intake: null,
        hasIntake: false,
        operationKey: null,
        anchor: null,
      },
    });
  });

  it("accepts a selected closed drink category in generation context", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "cheap wine in Soho for 2", context: { drinkCategory: "wine" } }),
      NOW,
    );
    expect(result).toMatchObject({ ok: true, value: { context: { drinkCategory: "wine" } } });
  });

  it("allowlists a requested three-to-six stop count", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "Camden", context: { stopCount: 6 } }),
      NOW,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { context: { stopCount: 6 } },
    });
  });

  it("rejects stop counts outside the planner choices", async () => {
    const result = await parsePlanGenerationRequest(
      request({ query: "Camden", context: { stopCount: 7 } }),
      NOW,
    );

    expect(result).toMatchObject({ ok: false, code: "MALFORMED_REQUEST" });
  });
});

describe("exact selected route requests", () => {
  it.each([1, 3, 6])("retains the exact chosen order for %i public venue IDs", async (stopCount) => {
    const routeVenueIds = Array.from({ length: stopCount }, (_, index) => `venue-${stopCount - index}`);
    const result = await parsePlanGenerationRequest(request({
      query: "Clapham", context: { stopCount }, routeVenueIds,
    }), NOW);
    expect(result).toMatchObject({ ok: true, value: { routeVenueIds } });
  });

  it.each([
    ["null", null],
    ["empty", []],
    ["too many", Array.from({ length: 7 }, (_, index) => `venue-${index}`)],
    ["duplicate", ["venue-a", "venue-a", "venue-c"]],
    ["non-string", ["venue-a", 2, "venue-c"]],
    ["blank ID", ["venue-a", "", "venue-c"]],
    ["whitespace ID", ["venue-a", " venue-b ", "venue-c"]],
    ["oversized ID", ["venue-a", "x".repeat(129), "venue-c"]],
    ["proof-unmintable ID", ["venue-a", "x".repeat(121), "venue-c"]],
    ["URL in place of ID", ["venue-a", "https://pub.example/b", "venue-c"]],
    ["private coordinate object", ["venue-a", { lat: 51, lng: 0 }, "venue-c"]],
  ])("rejects %s selection without admitting another public request shape", async (_label, routeVenueIds) => {
    const result = await parsePlanGenerationRequest(request({
      query: "Clapham", context: { stopCount: 3 }, routeVenueIds,
    }), NOW);
    expect(result).toMatchObject({ ok: false, code: "MALFORMED_REQUEST", status: 400 });
  });

  it("keeps the request closed beside a valid selected route", async () => {
    const result = await parsePlanGenerationRequest(request({
      query: "Clapham", routeVenueIds: ["venue-c", "venue-a", "venue-b"], privateContext: "must not cross this seam",
    }), NOW);
    expect(result).toMatchObject({ ok: false, code: "MALFORMED_REQUEST", status: 400 });
  });
});


describe("Cider bounded generation context", () => {
  it.each([null, "pint", "500ml"])("admits Cider request with selected measure %s", async (drinkServing) => {
    const context = { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing, zeroProof: false };
    const result = await parsePlanGenerationRequest(request({ query: "quiet in Clapham", context }), NOW);
    expect(result).toMatchObject({ ok: true, value: { context } });
  });

  it("admits the actual own named-eight Cider quote with unknown source serving", async () => {
    const selectedDrinkPriceEvidence = { category: "beer", pence: 365, serving: null, source: "listed",
      sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/", observedAt: "2026-09-21T18:27:31.674Z",
      drinkLabel: "Aspall 4.5%", drinkSubtype: "beer-cider" };
    const result = await parsePlanGenerationRequest(request({ context: { drinkCategory: "beer", drinkSubtype: "beer-cider" },
      anchor: { venueId: "venue-13xdb1p", source: "map-search", acceptedArea: null, startsAt: null, selectedDrinkPriceEvidence } }),
    new Date("2026-10-03T12:00:00.000Z"));
    expect(result).toMatchObject({ ok: true, value: { anchor: { venueId: "venue-13xdb1p", selectedDrinkPriceEvidence } } });
  });

  it.each([
    { drinkCategory: "wine", drinkSubtype: "beer-cider" },
    { drinkCategory: "beer", drinkSubtype: "beer-not-real" },
    { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing: "large bottle" },
    { drinkCategory: "beer", drinkSubtype: "beer-cider", drinkServing: "500ml", zeroProof: true },
    { drinkCategory: "beer", drinkSubtype: "beer-cider", servingPence: 365 },
  ])("rejects malformed or incompatible refinement %j", async (context) => {
    expect(await parsePlanGenerationRequest(request({ context }), NOW)).toMatchObject({ ok: false, code: "MALFORMED_REQUEST" });
  });
});
