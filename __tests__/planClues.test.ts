import { describe, expect, it } from "vitest";

import { landmarks } from "@/lib/landmarks";
import { PLAN_CLUE_CATALOGUE, selectPlanClues } from "@/lib/planClues";
import type { WalkLeg } from "@/lib/walkRoute";

const WESTMINSTER_LEG: WalkLeg = {
  fromIndex: 0, toIndex: 1, source: "ors",
  coordinates: [[-0.125, 51.5007], [-0.1246, 51.5007], [-0.124, 51.5007]],
};

describe("optional clues for the planned walk", () => {
  it("offers a sourced clue beside a routed leg without changing its stops", () => {
    const stops = ["first-pub", "second-pub"];
    const before = structuredClone(stops);
    const clues = selectPlanClues(stops, [WESTMINSTER_LEG]);
    expect(clues.map((clue) => clue.landmarkId)).toContain("big-ben");
    expect(clues.find((clue) => clue.landmarkId === "big-ben")).toMatchObject({
      fromVenueId: "first-pub", toVenueId: "second-pub", fromIndex: 0, toIndex: 1,
      answer: "Big Ben", source: { label: "UK Parliament" },
    });
    expect(stops).toEqual(before);
  });

  it("keeps every clue attached to a reviewed landmark and a named HTTPS source", () => {
    expect(PLAN_CLUE_CATALOGUE.length).toBeGreaterThanOrEqual(6);
    expect(PLAN_CLUE_CATALOGUE.length).toBeLessThanOrEqual(12);
    for (const clue of PLAN_CLUE_CATALOGUE) {
      expect(landmarks.find((landmark) => landmark.id === clue.landmarkId)?.history).toBeTruthy();
      expect(clue.source.label.trim()).not.toBe("");
      expect(new URL(clue.source.url).protocol).toBe("https:");
      expect(clue.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(clue.question).not.toMatch(/drink|pint|round|alcohol/i);
    }
  });

  it("removes missing or unsourced landmarks and never substitutes an ambient map point", () => {
    expect(selectPlanClues(["a", "b"], [WESTMINSTER_LEG], [])).toEqual([]);
    const brokenSource = PLAN_CLUE_CATALOGUE.map((clue) => ({ ...clue, source: { label: "", url: "" } }));
    expect(selectPlanClues(["a", "b"], [WESTMINSTER_LEG], landmarks, brokenSource)).toEqual([]);
    const unreviewed = [{ ...landmarks[0]!, id: "ambient-clock" }];
    expect(selectPlanClues(["a", "b"], [WESTMINSTER_LEG], unreviewed)).toEqual([]);
  });

  it("requires genuine nearby pavement geometry and the adjacent stops it belongs to", () => {
    expect(selectPlanClues(["a", "b"], [{ ...WESTMINSTER_LEG, source: "straight" }])).toEqual([]);
    expect(selectPlanClues(["a", "b"], [{ ...WESTMINSTER_LEG, coordinates: [[0, 52], [0.01, 52]] }])).toEqual([]);
    expect(selectPlanClues(["a", "b"], [{ ...WESTMINSTER_LEG, toIndex: 3 }])).toEqual([]);
    expect(selectPlanClues(["a", "b"], [{ ...WESTMINSTER_LEG, coordinates: [[NaN, 51], [-0.12, 51]] }])).toEqual([]);
  });
});
