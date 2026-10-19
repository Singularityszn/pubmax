import { describe, expect, it } from "vitest";

import {
  PAL_WALK_PAUSE_MS,
  palWalkAt,
  palWalkMs,
  palWalkPathFrom,
  palWalkPlan,
  palWalkPointAt,
  palWalkStopsFromKey,
  palVisitMs,
  type LngLat,
} from "@/components/map/canvas/palWalk";

// Three stops about 700 m apart, walking east and then back west.
const stops: LngLat[] = [[-0.1, 51.5], [-0.09, 51.5], [-0.095, 51.505]];

describe("the Pal's walk along a crawl", () => {
  it("needs two stops and a line with length", () => {
    expect(palWalkPlan([[-0.1, 51.5]], [[-0.1, 51.5]])).toBeNull();
    expect(palWalkPlan([[-0.1, 51.5], [-0.1, 51.5]], [[-0.1, 51.5], [-0.1, 51.5]])).toBeNull();
  });

  it("starts at the first stop, pauses at the middle one and ends at the last", () => {
    const plan = palWalkPlan(stops, stops)!;
    expect(plan.stopsAt[0]).toBe(0);
    expect(plan.stopsAt[2]).toBe(plan.total);
    expect(plan.durationMs).toBe(palWalkMs(plan.total) + PAL_WALK_PAUSE_MS);

    const start = palWalkAt(plan, 0);
    expect(start.at).toEqual(stops[0]);
    expect(start.done).toBe(false);
    expect(start.heading).toBe(1);

    const msPerMetre = palWalkMs(plan.total) / plan.total;
    const reachMiddle = plan.stopsAt[1]! * msPerMetre;
    const pausing = palWalkAt(plan, reachMiddle + PAL_WALK_PAUSE_MS / 2);
    expect(pausing.pausedAt).toBe(1);
    expect(pausing.at[0]).toBeCloseTo(stops[1]![0], 9);

    const heading = palWalkAt(plan, reachMiddle + PAL_WALK_PAUSE_MS + 100);
    expect(heading.pausedAt).toBeNull();
    expect(heading.heading).toBe(-1);

    const end = palWalkAt(plan, plan.durationMs + 1);
    expect(end.done).toBe(true);
    expect(end.at[0]).toBeCloseTo(stops[2]![0], 9);
    expect(end.at[1]).toBeCloseTo(stops[2]![1], 9);
  });

  it("keeps a walk inside its time window, however long the route", () => {
    expect(palWalkMs(10)).toBe(5_000);
    expect(palWalkMs(1_500)).toBe(9_000);
    expect(palWalkMs(50_000)).toBe(16_000);
  });

  it("never walks backwards along a road line that passes a stop twice", () => {
    // The road passes the middle stop early, then loops round and reaches it again.
    const road: LngLat[] = [[-0.1, 51.5], [-0.09, 51.5], [-0.09, 51.51], [-0.1, 51.51], [-0.09, 51.5001], [-0.08, 51.5]];
    const plan = palWalkPlan(road, [[-0.1, 51.5], [-0.09, 51.5], [-0.08, 51.5]])!;
    expect(plan.stopsAt[1]).toBeGreaterThan(0);
    expect(plan.stopsAt[1]).toBeLessThanOrEqual(plan.stopsAt[2]!);
    let last = -Infinity;
    for (let t = 0; t <= plan.durationMs; t += 250) {
      const { at } = palWalkAt(plan, t);
      const walked = plan.path.findIndex((point) => point[0] === at[0] && point[1] === at[1]);
      if (walked >= 0) {
        expect(walked).toBeGreaterThanOrEqual(last);
        last = walked;
      }
    }
  });

  it("reads the road line and the canvas's stop key", () => {
    expect(palWalkPathFrom({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: [[[1, 1], [2, 2]]] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [9, 9] } },
      ],
    })).toEqual([[0, 0], [1, 1], [1, 1], [2, 2]]);
    expect(palWalkStopsFromKey("-0.1,51.5;-0.09,51.51")).toEqual([[-0.1, 51.5], [-0.09, 51.51]]);
    expect(palWalkStopsFromKey("")).toEqual([]);
  });

  it("keeps a trip to a tapped stop brisk, either way along the route", () => {
    expect(palVisitMs(0)).toBe(600);
    expect(palVisitMs(-500)).toBe(2_000);
    expect(palVisitMs(500)).toBe(2_000);
    expect(palVisitMs(10_000)).toBe(3_500);
    const plan = palWalkPlan(stops, stops)!;
    const middle = palWalkPointAt(plan, plan.stopsAt[1]!);
    expect(middle.metres).toBe(plan.stopsAt[1]);
    expect(middle.at[0]).toBeCloseTo(stops[1]![0], 9);
  });
});

