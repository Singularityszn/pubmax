import { describe, expect, it } from "vitest";

import { DESCRIBE_FIRST_CHIPS } from "@/components/plan/PlanDescribeFirst";
import { inferNightContext } from "@/lib/nightPlanning";

/** Fixed London afternoon so default daypart cannot mask missing occasion words. */
const AFTERNOON = new Date("2026-08-07T13:00:00.000Z");
/** Fixed London evening so daytime chip language must win over the clock default. */
const EVENING = new Date("2026-08-07T19:30:00.000Z");

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

  it("maps soft-drink language onto the zero-proof preference generate already ranks on", () => {
    expect(inferNightContext("soft drinks in Camden for 3", EVENING).context.zeroProof).toBe(true);
    expect(inferNightContext("a soft drink in Shoreditch", EVENING).context.zeroProof).toBe(true);
  });

  it("maps coffee and catch-up language to daytime even against an evening clock", () => {
    expect(inferNightContext("coffee in Clapham for 2", EVENING).context.daypart).toBe("daytime");
    expect(inferNightContext("a catch-up in Clapham for 2", EVENING).context.daypart).toBe("daytime");
  });

  it("keeps an explicit tonight evening when coffee is also mentioned", () => {
    expect(inferNightContext("coffee tonight in Clapham", AFTERNOON).context.daypart).toBe("evening");
  });
});

describe("DESCRIBE_FIRST_CHIPS occasion parsing", () => {
  // Each chip label is a promise of parsed occasion fields, not only HTTP 200.
  // Generate has no Wetherspoons chain filter: the Spoons chip pins daytime +
  // value only. Residual gap: route stops are not forced onto the directory.

  it("covers every shipped describe-first chip", () => {
    expect(DESCRIBE_FIRST_CHIPS).toEqual([
      "Quiet in Clapham for 4, not pricey",
      "cheap pints tonight in Shoreditch",
      "alcohol-free drinks in Camden for 3",
      "quiet afternoon in Clapham for 2, soft drinks",
      "food then a soft drink in Shoreditch for 4",
      "coffee and a catch-up in Clapham for 2",
      "chill Wetherspoons in Clapham for 3",
    ]);
  });

  it.each([
    [
      "Quiet in Clapham for 4, not pricey",
      {
        nightArea: "clapham",
        groupSize: 4,
        budget: "value",
        atmosphere: ["quiet"],
        zeroProof: false,
      },
      EVENING,
    ],
    [
      "cheap pints tonight in Shoreditch",
      {
        nightArea: "shoreditch",
        daypart: "evening",
        budget: "value",
        zeroProof: false,
      },
      AFTERNOON,
    ],
    [
      "alcohol-free drinks in Camden for 3",
      {
        nightArea: "camden",
        groupSize: 3,
        zeroProof: true,
      },
      EVENING,
    ],
    [
      "quiet afternoon in Clapham for 2, soft drinks",
      {
        nightArea: "clapham",
        daypart: "daytime",
        groupSize: 2,
        atmosphere: ["quiet"],
        zeroProof: true,
      },
      EVENING,
    ],
    [
      "food then a soft drink in Shoreditch for 4",
      {
        nightArea: "shoreditch",
        groupSize: 4,
        foodNeeds: ["food"],
        zeroProof: true,
      },
      EVENING,
    ],
    [
      "coffee and a catch-up in Clapham for 2",
      {
        nightArea: "clapham",
        daypart: "daytime",
        groupSize: 2,
        zeroProof: false,
      },
      EVENING,
    ],
    [
      "chill Wetherspoons in Clapham for 3",
      {
        nightArea: "clapham",
        daypart: "daytime",
        groupSize: 3,
        budget: "value",
        atmosphere: ["quiet"],
        zeroProof: false,
      },
      EVENING,
    ],
  ] as const)("honours the occasion promised by %s", (chip, expected, now) => {
    expect(DESCRIBE_FIRST_CHIPS).toContain(chip);
    expect(inferNightContext(chip, now).context).toMatchObject(expected);
  });
});
