import { describe, expect, it } from "vitest";

import {
  INTERCEPT_ETA_OPTIONS,
  recommendCrawlIntercept,
} from "@/lib/crawlIntercept";
import type { PlanActionDTO, PlanState, PlanStopDTO } from "@/lib/plan";

function stop(position: number, venueName = `Pub ${position}`): PlanStopDTO {
  return { venueId: `venue-${position}`, venueName, position };
}

function action(
  type: PlanActionDTO["type"],
  stopPosition: number | null,
  id = `${type}-${String(stopPosition)}`,
): PlanActionDTO {
  return {
    id,
    type,
    stopPosition,
    ending: type === "ending" ? "get_home" : null,
    createdAt: "2026-07-22T20:00:00.000Z",
  };
}

function plan(stops: PlanStopDTO[], actions?: PlanActionDTO[]): PlanState {
  return {
    plan: {
      id: "plan-intercept",
      title: "Late crew crawl",
      startTime: "2026-07-22T19:30:00.000Z",
      createdAt: "2026-07-22T18:00:00.000Z",
    },
    stops,
    crew: [],
    actions,
  };
}

describe("recommendCrawlIntercept", () => {
  it("publishes the fixed public ETA choices", () => {
    expect(INTERCEPT_ETA_OPTIONS).toEqual([0, 15, 30, 45, 60]);
  });

  it("sorts stops by position without mutating the stored route", () => {
    const stored = [stop(20, "Third"), stop(4, "First"), stop(11, "Second")];

    const result = recommendCrawlIntercept(plan(stored), 45);

    expect(result).toMatchObject({
      stop: { venueName: "Second", position: 11 },
      currentIndex: 0,
      targetIndex: 1,
      etaMinutes: 45,
      kind: "ahead",
    });
    expect(stored.map((item) => item.venueName)).toEqual(["Third", "First", "Second"]);
  });

  it("treats the first stop as current when there are no actions", () => {
    const result = recommendCrawlIntercept(plan([stop(0), stop(1), stop(2)]), 30);

    expect(result).toMatchObject({
      stop: { position: 0 },
      currentIndex: 0,
      targetIndex: 0,
      etaMinutes: 30,
      kind: "current",
    });
  });

  it("uses arrived and skipped actions as honest progress", () => {
    const state = plan(
      [stop(0), stop(1), stop(2), stop(3)],
      [action("arrived", 0), action("skipped", 1)],
    );

    expect(recommendCrawlIntercept(state, 0)).toMatchObject({
      stop: { position: 2 },
      currentIndex: 2,
      targetIndex: 2,
      kind: "current",
    });
    expect(recommendCrawlIntercept(state, 60)).toMatchObject({
      stop: { position: 3 },
      currentIndex: 2,
      targetIndex: 3,
      kind: "final",
    });
  });

  it("clamps a long ETA to the largest option and never passes the final stop", () => {
    const result = recommendCrawlIntercept(plan([stop(0), stop(1)]), 10_000);

    expect(result).toMatchObject({
      stop: { position: 1 },
      currentIndex: 0,
      targetIndex: 1,
      etaMinutes: 60,
      kind: "final",
    });
  });

  it("returns the final stop when every stop has been completed", () => {
    const result = recommendCrawlIntercept(
      plan([stop(2, "Last"), stop(0, "First")], [action("arrived", 0), action("skipped", 2)]),
      0,
    );

    expect(result).toMatchObject({
      stop: { venueName: "Last" },
      currentIndex: 1,
      targetIndex: 1,
      kind: "final",
    });
  });

  it("does not double-count duplicate or old actions and ignores other action types", () => {
    const state = plan(
      [stop(10), stop(20), stop(30)],
      [
        action("arrived", 10, "old-arrival"),
        action("skipped", 10, "new-skip"),
        action("swapped", 20),
        action("ending", null),
        action("arrived", 999, "removed-stop-arrival"),
      ],
    );

    expect(recommendCrawlIntercept(state, 0)).toMatchObject({
      stop: { position: 20 },
      currentIndex: 1,
      targetIndex: 1,
      kind: "current",
    });
  });

  it.each([
    { input: 44, expected: 45 },
    { input: "58", expected: 60 },
    { input: -100, expected: 0 },
    { input: 7.5, expected: 0 },
    { input: Number.NaN, expected: 0 },
    { input: Number.POSITIVE_INFINITY, expected: 0 },
    { input: "not-an-eta", expected: 0 },
    { input: null, expected: 0 },
  ])("normalizes $input to the nearest supported ETA ($expected)", ({ input, expected }) => {
    expect(recommendCrawlIntercept(plan([stop(0), stop(1)]), input)?.etaMinutes).toBe(expected);
  });

  it("returns null for a plan without stops", () => {
    expect(recommendCrawlIntercept(plan([]), 45)).toBeNull();
  });
});
