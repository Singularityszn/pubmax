import { describe, expect, it } from "vitest";
import {
  COMPASS_RESET_DURATION_MS,
  COMPASS_SETTLED_EPSILON,
  cameraResetAvailable,
  compassResetLabel,
  compassResetTarget,
  mapIsOffHouseAttitude,
} from "@/lib/mapCompass";

const LONDON = { pitch: 42, bearing: -12 };

describe("compassResetTarget", () => {
  it("hands back the city's own attitude, both axes", () => {
    expect(compassResetTarget(LONDON)).toEqual({ bearing: -12, pitch: 42 });
  });

  it("rests an absent axis at zero rather than inventing one", () => {
    expect(compassResetTarget({ pitch: 30 })).toEqual({ bearing: 0, pitch: 30 });
    expect(compassResetTarget({ bearing: -6 })).toEqual({ bearing: -6, pitch: 0 });
    expect(compassResetTarget({})).toEqual({ bearing: 0, pitch: 0 });
  });
});

describe("mapIsOffHouseAttitude", () => {
  it("is false at the designed attitude", () => {
    expect(mapIsOffHouseAttitude(-12, 42, LONDON)).toBe(false);
  });

  // The old control appeared only at north, so the moment somebody turned the
  // map it went away. A turned map is exactly when a reset is wanted.
  it("is true once the map is turned, in either direction", () => {
    expect(mapIsOffHouseAttitude(0, 42, LONDON)).toBe(true);
    expect(mapIsOffHouseAttitude(-90, 42, LONDON)).toBe(true);
    expect(mapIsOffHouseAttitude(75, 42, LONDON)).toBe(true);
  });

  // MapLibre's compass flattened pitch to nothing. A view that lost the tilt
  // is not the view the city opens on, so pitch is half the question.
  it("is true once the map is tilted off the designed pitch", () => {
    expect(mapIsOffHouseAttitude(-12, 0, LONDON)).toBe(true);
    expect(mapIsOffHouseAttitude(-12, 60, LONDON)).toBe(true);
  });

  it("treats a sub-epsilon nudge on either axis as settled", () => {
    expect(mapIsOffHouseAttitude(-12 + COMPASS_SETTLED_EPSILON, 42, LONDON)).toBe(false);
    expect(mapIsOffHouseAttitude(-12, 42 - COMPASS_SETTLED_EPSILON, LONDON)).toBe(false);
    expect(mapIsOffHouseAttitude(-12 + COMPASS_SETTLED_EPSILON + 0.01, 42, LONDON)).toBe(true);
    expect(mapIsOffHouseAttitude(-12, 42 + COMPASS_SETTLED_EPSILON + 0.01, LONDON)).toBe(true);
  });

  it("has nothing to reset on a city with no designed attitude", () => {
    expect(mapIsOffHouseAttitude(0, 0, {})).toBe(false);
    expect(mapIsOffHouseAttitude(30, 0, {})).toBe(true);
  });
});

describe("compass copy and timing", () => {
  it("names the city it resets, in the house voice", () => {
    expect(compassResetLabel("London")).toBe("Reset the map view of London");
    expect(compassResetLabel("Manchester")).toBe("Reset the map view of Manchester");
  });

  it("eases rather than jumping", () => {
    expect(COMPASS_RESET_DURATION_MS).toBeGreaterThan(0);
    expect(COMPASS_RESET_DURATION_MS).toBeLessThanOrEqual(700);
  });
});

describe("cameraResetAvailable", () => {
  it("offers the reset only on a live canvas that is off the city's attitude", () => {
    expect(cameraResetAvailable(true, false)).toBe(true);
    expect(cameraResetAvailable(false, false)).toBe(false);
  });

  it("withholds the reset once the canvas has failed, whatever the last attitude", () => {
    expect(cameraResetAvailable(true, true)).toBe(false);
    expect(cameraResetAvailable(false, true)).toBe(false);
  });
});
