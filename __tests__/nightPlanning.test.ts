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
});
