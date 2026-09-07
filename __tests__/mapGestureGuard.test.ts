import { describe, expect, it } from "vitest";
import {
  GESTURE_CAMERA_HOLD_MS,
  REACTIVE_CAMERA_INTENTS,
  cameraIntentBlocked,
  idleGestureCameraState,
  isReactiveCameraIntent,
} from "@/lib/mapGestureGuard";

const HELD = { active: true, endedAt: null };
const JUST_LET_GO = (now: number) => ({ active: false, endedAt: now });

describe("cameraIntentBlocked — a gesture in hand", () => {
  it("stops every camera writer while fingers are on the glass", () => {
    for (const kind of ["city", "cluster", "nearby", "query", "route", "venue", "landmark", "area"] as const) {
      expect(cameraIntentBlocked(kind, HELD, 1_000)).toBe(true);
    }
  });

  it("lets everything through when the reader has moved nothing", () => {
    for (const kind of ["city", "query", "route", "venue"] as const) {
      expect(cameraIntentBlocked(kind, idleGestureCameraState(), 1_000)).toBe(false);
    }
  });
});

describe("cameraIntentBlocked — the hold after a gesture", () => {
  it("keeps a reactive fit off the map for the whole hold", () => {
    expect(cameraIntentBlocked("route", JUST_LET_GO(1_000), 1_000)).toBe(true);
    expect(cameraIntentBlocked("query", JUST_LET_GO(1_000), 1_000 + GESTURE_CAMERA_HOLD_MS - 1)).toBe(true);
  });

  it("gives the camera back once the hold is spent", () => {
    expect(cameraIntentBlocked("route", JUST_LET_GO(1_000), 1_000 + GESTURE_CAMERA_HOLD_MS)).toBe(false);
    expect(cameraIntentBlocked("query", JUST_LET_GO(1_000), 9_999)).toBe(false);
  });

  // Panning to a pin and then tapping it is the ordinary way into a venue. A
  // two second dead spot there would be a worse defect than the one the hold
  // exists to fix, so a move the reader ASKED for is never held.
  it("never holds a move the reader asked for", () => {
    for (const kind of ["venue", "cluster", "city", "nearby", "landmark", "area"] as const) {
      expect(cameraIntentBlocked(kind, JUST_LET_GO(1_000), 1_001)).toBe(false);
    }
  });

  it("honours a caller's own hold length", () => {
    expect(cameraIntentBlocked("route", JUST_LET_GO(0), 50, 100)).toBe(true);
    expect(cameraIntentBlocked("route", JUST_LET_GO(0), 150, 100)).toBe(false);
  });
});

describe("the reactive set is closed", () => {
  it("names exactly the moves no reader asked for", () => {
    // `query` and `route` fire off changed data; `arrival` is the map's own
    // opening turn (lib/mapArrivalBearing.ts). Nothing else joins this set
    // without a reason written beside it.
    expect([...REACTIVE_CAMERA_INTENTS].sort()).toEqual([
      "arrival",
      "query",
      "route",
    ]);
  });

  it("answers per kind", () => {
    expect(isReactiveCameraIntent("route")).toBe(true);
    expect(isReactiveCameraIntent("venue")).toBe(false);
  });

  it("holds long enough to cover a read, short enough to feel like nothing", () => {
    expect(GESTURE_CAMERA_HOLD_MS).toBe(2_000);
  });
});
