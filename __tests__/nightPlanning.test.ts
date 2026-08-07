import { describe, expect, it } from "vitest";

import { DESCRIBE_FIRST_CHIPS } from "@/components/plan/PlanDescribeFirst";
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
      wetherspoonsPreferred: false,
    });
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nightArea", evidence: "Clapham" }),
      expect.objectContaining({ field: "groupSize", evidence: "Four" }),
    ]));
  });

  it("uses London time for an omitted daypart and never invents a Home Area", () => {
    const result = inferNightContext("A quiet solo night in Barnes", new Date("2026-07-13T13:00:00.000Z"));
    expect(result.context).toMatchObject({ nightArea: "barnes", daypart: "daytime", partyType: "solo", wetherspoonsPreferred: false });
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

  it.each([
    "chill Wetherspoons in Clapham for 3",
    "Spoons near Camden this afternoon",
    "a Wetherspoon lunch in Soho",
  ])("soft-prefers the first-party directory when free text names Spoons: %s", (query) => {
    const result = inferNightContext(query, new Date("2026-07-13T18:00:00.000Z"));
    expect(result.context.wetherspoonsPreferred).toBe(true);
    expect(result.context.budget).toBe("value");
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "wetherspoonsPreferred", evidence: "Wetherspoons" }),
    ]));
  });

  it("leaves wetherspoonsPreferred false when the chain is not named", () => {
    expect(inferNightContext("Quiet in Clapham for 4, not pricey").context.wetherspoonsPreferred).toBe(false);
  });

  it("defaults a Spoons outing to daytime when no clock word is stated", () => {
    const result = inferNightContext(
      "chill Wetherspoons in Clapham for 3",
      new Date("2026-07-13T18:00:00.000Z"),
    );
    expect(DESCRIBE_FIRST_CHIPS).toContain("chill Wetherspoons in Clapham for 3");
    expect(result.context).toMatchObject({
      nightArea: "clapham",
      daypart: "daytime",
      groupSize: 3,
      budget: "value",
      wetherspoonsPreferred: true,
    });
  });

  it("keeps an explicit evening clock word over the Spoons daytime default", () => {
    const result = inferNightContext(
      "Wetherspoons tonight in Clapham for 3",
      new Date("2026-07-13T12:00:00.000Z"),
    );
    expect(result.context).toMatchObject({
      daypart: "evening",
      budget: "value",
      wetherspoonsPreferred: true,
    });
  });
});
