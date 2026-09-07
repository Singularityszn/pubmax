import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAP_ARRIVAL_BEARING_DEG,
  MAP_ARRIVAL_BEARING_DURATION_MS,
  mapArrivalBearingPlan,
} from "@/lib/mapArrivalBearing";
import { REACTIVE_CAMERA_INTENTS } from "@/lib/mapGestureGuard";

const flat = {
  currentBearing: 0,
  reducedMotion: false,
  deepLinkedVenue: false,
};

describe("the map's opening turn", () => {
  it("eases a flat arrival to four degrees over one second", () => {
    expect(mapArrivalBearingPlan(flat)).toEqual({
      bearing: MAP_ARRIVAL_BEARING_DEG,
      duration: MAP_ARRIVAL_BEARING_DURATION_MS,
    });
    expect(MAP_ARRIVAL_BEARING_DEG).toBe(4);
    expect(MAP_ARRIVAL_BEARING_DURATION_MS).toBe(1_000);
  });

  it("makes no motion at all under reduced motion", () => {
    // Not a duration-0 jump: the turn carries no information, so there is
    // nothing to hand back without the motion.
    expect(mapArrivalBearingPlan({ ...flat, reducedMotion: true })).toBeNull();
  });

  it("stands aside for a deep link to a selected venue", () => {
    expect(mapArrivalBearingPlan({ ...flat, deepLinkedVenue: true })).toBeNull();
  });

  it("leaves a rotation somebody already owns", () => {
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: -8 })).toBeNull();
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: 32.5 })).toBeNull();
  });

  it("treats a hair off north as the flat arrival", () => {
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: 0.2 })).not.toBeNull();
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: -0.2 })).not.toBeNull();
  });

  it("refuses a bearing that is not a number", () => {
    expect(mapArrivalBearingPlan({ ...flat, currentBearing: Number.NaN })).toBeNull();
  });
});

describe("the opening turn is not the idle orbit", () => {
  const camera = readFileSync(
    resolve(process.cwd(), "components/map/canvas/useMapCamera.ts"),
    "utf8",
  );
  const canvas = readFileSync(
    resolve(process.cwd(), "components/PubMapCanvas.tsx"),
    "utf8",
  );

  it("moves once, through the one camera lane", () => {
    expect(camera).toContain("mapArrivalBearingPlan");
    expect(camera).toMatch(/scheduleCamera\(\s*"arrival"/);
  });

  it("stands down while a reader holds the map", () => {
    expect(REACTIVE_CAMERA_INTENTS).toContain("arrival");
  });

  it("is spent once per mounted map, so a context rebuild cannot re-turn it", () => {
    expect(canvas).toContain("arrivalBearingSpentRef");
    expect(canvas).toMatch(/arrivalBearingSpentRef\.current = true/);
  });

  it("reads the deep link as it was on arrival, not as it is now", () => {
    expect(canvas).toContain("arrivalDeepLinkRef");
  });
});
