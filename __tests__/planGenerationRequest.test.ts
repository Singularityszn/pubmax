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
  it("accepts an optional canonical Plan schedule outside explicit context and intake", async () => {
    const result = await parsePlanGenerationRequest(request({
      query: "Clapham", planStartIso: "2026-07-20T19:00:00.000Z",
    }), NOW);
    expect(result).toMatchObject({ ok: true, value: {
      planStartIso: "2026-07-20T19:00:00.000Z", context: null, intake: null,
    } });
  });

  it.each([null, 42, {}, "", "tomorrow", "2026-02-30T18:00:00.000Z", "2026-07-20T19:00:00+01:00"])(
    "rejects a malformed Plan schedule hint %j", async (planStartIso) => {
      const result = await parsePlanGenerationRequest(request({ query: "Clapham", planStartIso }), NOW);
      expect(result).toMatchObject({ ok: false, code: "MALFORMED_REQUEST", status: 400 });
    },
  );

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
    ["an unknown area focus", { areaFocus: "covent-garden" }],
    ["a non-string area focus", { areaFocus: 42 }],
  ])("still rejects non-null malformed context: %s", async (_label, context) => {
    const result = await parsePlanGenerationRequest(request({ query: "Clapham classics", context }), NOW);

    expect(result).toEqual({
      ok: false,
      code: "MALFORMED_REQUEST",
      message: "Night Context is invalid.",
      status: 400,
    });
  });

  it.each(["soho", "piccadilly", null])("preserves explicit area focus %j", async (areaFocus) => {
    const result = await parsePlanGenerationRequest(request({
      context: { nightArea: "piccadilly-soho", areaFocus },
    }), NOW);

    expect(result).toMatchObject({ ok: true, value: {
      context: { nightArea: "piccadilly-soho", areaFocus },
    } });
  });

  it("keeps an omitted area focus absent", async () => {
    const result = await parsePlanGenerationRequest(request({
      context: { nightArea: "piccadilly-soho" },
    }), NOW);

    if (!result.ok) throw new Error(result.message);
    expect(result.value.context).toEqual({ nightArea: "piccadilly-soho" });
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

it.each([[], ["a", "b"], ["a", "b", "b"], ["b", "c", "d"], ["a", "b", "bad id"], Array.from({ length: 7 }, (_, i) => `id-${i}`)].map((ids) => [ids]))(
  "rejects an invalid imported cluster %j", async (venueIds) => {
    const result = await parsePlanGenerationRequest(request({ query: "Soho", anchor: {
      venueId: "a", source: "map-search", acceptedArea: null, startsAt: null, venueIds,
    } }), NOW);
    expect(result.ok).toBe(false);
  },
);
