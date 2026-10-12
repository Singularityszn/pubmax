import { describe, expect, it } from "vitest";
import { inferDescribeStopCount } from "@/lib/planDescribeStopCount";
import { inferNightContext } from "@/lib/nightPlanning";

describe("describe-first requested stop counts", () => {
  it.each([
    ["one pub", 1], ["two venues", 2], ["THREE STOPS", 3],
    ["four pubs in Camden", 4], ["Five pubs", 5], ["six pubs", 6],
    ["1 venue", 1], ["2 stops", 2], ["3 pubs", 3],
    ["4 venues", 4], ["5 stops", 5], ["6 pubs", 6],
    ["big crawl in Camden", 6], ["seven pubs", 3], ["8 pubs", 3],
    ["for five people", 3], ["quiet in Camden", 3],
    ["<FIVE>\u0000pubs", 5],
  ])("reads %s as %i stops", (query, expected) => {
    expect(inferDescribeStopCount(query)).toBe(expected);
    expect(inferNightContext(query).context.stopCount).toBe(expected);
  });

  it("does not infer a count beyond the canonical 500-code-point text boundary", () => {
    expect(inferDescribeStopCount(`${"x".repeat(500)} 6 pubs`)).toBe(3);
    expect(inferDescribeStopCount(`${"👩‍👩‍👧‍👦".repeat(70)} 6 pubs`)).toBe(6);
    expect(inferDescribeStopCount(`${"👩‍👩‍👧‍👦".repeat(71)} 6 pubs`)).toBe(3);
  });

  it.each([null, undefined, 6, { query: "six pubs" }])("defaults an untrusted non-text value", (query) => {
    expect(inferDescribeStopCount(query)).toBe(3);
  });

  it.each([["seven", 7], ["eight", 8]])("keeps %s in the full planner's group-size vocabulary", (word, expected) => {
    expect(inferNightContext(`for ${word} people`).context.groupSize).toBe(expected);
    expect(inferNightContext(`for ${word} people`).context.stopCount).toBe(3);
  });
});
