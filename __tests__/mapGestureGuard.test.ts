// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  GESTURE_CAMERA_HOLD_MS,
  REACTIVE_CAMERA_INTENTS,
  cameraIntentBlocked,
  idleGestureCameraState,
  installMapGestureGuard,
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

  it("keeps a voice answer's framing off a map the reader is still reading", () => {
    expect(cameraIntentBlocked("pal", JUST_LET_GO(1_000), 1_500)).toBe(true);
    expect(cameraIntentBlocked("pal", HELD, 1_500)).toBe(true);
    expect(cameraIntentBlocked("pal", idleGestureCameraState(), 1_500)).toBe(false);
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
    // opening turn (lib/mapArrivalBearing.ts); `pal` lands when a voice answer
    // arrives, seconds after the ask. Nothing else joins this set without a
    // reason written beside it.
    expect([...REACTIVE_CAMERA_INTENTS].sort()).toEqual([
      "arrival",
      "pal",
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


describe("map contact ownership", () => {
  it.each(["pointer", "touch"])("captures %s contact on a marker that stops propagation", (contact) => {
    const container = document.createElement("div");
    const marker = document.createElement("button");
    container.append(document.createElement("canvas"), marker);
    const state = { current: idleGestureCameraState() };
    const guard = installMapGestureGuard(container, state, () => {});
    const type = contact === "pointer" ? "pointerdown" : "touchstart";
    marker.addEventListener(type, (event) => event.stopPropagation());
    marker.dispatchEvent(Object.assign(new Event(type, { bubbles: true }),
      contact === "pointer" ? { pointerId: 1 } : { changedTouches: [{ identifier: 1 }] }));
    expect(cameraIntentBlocked("pal", state.current, performance.now())).toBe(true);
    window.dispatchEvent(Object.assign(new Event(contact === "pointer" ? "pointercancel" : "touchcancel"),
      contact === "pointer" ? { pointerId: 1 } : { changedTouches: [{ identifier: 1 }] }));
    expect(state.current.active).toBe(false);
    guard.dispose();
    marker.dispatchEvent(Object.assign(new Event(type, { bubbles: true }),
      contact === "pointer" ? { pointerId: 1 } : { changedTouches: [{ identifier: 1 }] }));
    expect(state.current).toEqual(idleGestureCameraState());
  });

  it("releases every contact on blur and removes blur recovery on disposal", () => {
    const canvas = document.createElement("canvas");
    const state = { current: idleGestureCameraState() };
    const guard = installMapGestureGuard(canvas, state, () => {});
    const pointer = (type: string, id: number) => Object.assign(new Event(type), { pointerId: id });
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(Object.assign(new Event("touchstart"), { changedTouches: [{ identifier: 2 }] }));
    guard.begin("drag")({ originalEvent: true });
    window.dispatchEvent(new Event("blur"));
    expect(state.current.active).toBe(false);
    expect(cameraIntentBlocked("venue", state.current, performance.now())).toBe(false);
    expect(cameraIntentBlocked("pal", state.current, performance.now())).toBe(true);
    canvas.dispatchEvent(pointer("pointerdown", 3));
    expect(state.current.active).toBe(true);
    window.dispatchEvent(pointer("pointerup", 3));
    expect(state.current.active).toBe(false);
    guard.dispose();
    state.current = { active: true, endedAt: null };
    window.dispatchEvent(new Event("blur"));
    expect(state.current.active).toBe(true);
  });

  it.each(["pointerup", "pointercancel"])("holds stationary pointers until the last %s, including off-canvas release", (release) => {
    const canvas = document.createElement("canvas");
    const state = { current: idleGestureCameraState() };
    const guard = installMapGestureGuard(canvas, state, () => {});
    const pointer = (type: string, id: number) => Object.assign(new Event(type), { pointerId: id });
    canvas.dispatchEvent(pointer("pointerdown", 1));
    canvas.dispatchEvent(pointer("pointerdown", 2));
    guard.settle();
    expect(cameraIntentBlocked("pal", state.current, performance.now())).toBe(true);
    window.dispatchEvent(pointer(release, 1));
    expect(cameraIntentBlocked("route", state.current, performance.now())).toBe(true);
    window.dispatchEvent(pointer(release, 2));
    expect(state.current.active).toBe(false);
    expect(cameraIntentBlocked("pal", state.current, performance.now())).toBe(true);
    expect(cameraIntentBlocked("route-recovery", state.current, performance.now())).toBe(false);
    guard.dispose();
    canvas.dispatchEvent(pointer("pointerdown", 3));
    expect(state.current).toEqual(idleGestureCameraState());
  });

  it("keeps contact ownership when a moving gesture ends and releases cancelled touches", () => {
    const canvas = document.createElement("canvas");
    const state = { current: idleGestureCameraState() };
    const guard = installMapGestureGuard(canvas, state, () => {});
    const touch = (type: string) => Object.assign(new Event(type), { changedTouches: [{ identifier: 1 }] });
    canvas.dispatchEvent(touch("touchstart"));
    guard.begin("rotate")({ originalEvent: true });
    guard.end("rotate")();
    expect(state.current.active).toBe(true);
    window.dispatchEvent(touch("touchcancel"));
    expect(state.current.active).toBe(false);
    guard.dispose();
  });
});
