import { describe, expect, it } from "vitest";

import { inferNightContext } from "@/lib/nightPlanning";

describe("inferNightContext", () => {
  it("turns a natural-language night into editable, explained context", () => {
    const result = inferNightContext("Four of us after work in Clapham, cheap, lively, kebab after");

    expect(result.context).toMatchObject({
      nightArea: "clapham",
      daypart: "after_work",
      partyType: "friends",
      groupSize: 4,
      budget: "value",
      atmosphere: ["lively"],
      foodNeeds: ["kebab"],
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nightArea", evidence: "Clapham" }),
      expect.objectContaining({ field: "groupSize", evidence: "Four" }),
    ]));
  });

  it("uses London time for an omitted daypart and never invents a Home Area", () => {
    const result = inferNightContext("A quiet solo night in Barnes", new Date("2026-07-13T13:00:00.000Z"));
    expect(result.context).toMatchObject({ nightArea: "barnes", daypart: "daytime", partyType: "solo" });
    expect(result.context).not.toHaveProperty("homeArea");
  });

  it.each([
    ["Quiet in Clapham for 4, not pricey", 4],
    ["A party of five in Soho", 5],
    ["A group of 6 near Victoria", 6],
  ])("recognises compact group-size phrasing: %s", (query, groupSize) => {
    expect(inferNightContext(query).context.groupSize).toBe(groupSize);
  });

  it("recognises reviewed expansion aliases without treating them as route-ready", () => {
    const result = inferNightContext("A quiet evening near Camden Town");
    expect(result.context.nightArea).toBe("camden");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nightArea", evidence: "Camden Town" }),
    ]));
  });

  it("captures an explicit per-person route budget without inventing one", () => {
    expect(inferNightContext("Clapham tonight, keep it under £24 each").context.budgetLimitPence).toBe(2400);
    expect(inferNightContext("Clapham tonight, standard budget").context.budgetLimitPence).toBeNull();
  });
});
