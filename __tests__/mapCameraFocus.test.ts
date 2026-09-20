// Picking an area must move the map, every time.
//
// DEFECT (captain, live, 2026-09-01, mobile): the map header read
// "Piccadilly & Soho" over a viewport of rural Cumbria. The chip is written
// from the remembered area, so it changed; the camera did not.
//
// The canvas takes ONE focus prop fed by TWO owners - the opening-location
// answer and the area lane - and each kept its own counter starting at 1 while
// the canvas remembered one bare number. A reader whose opening location had
// flown at token 1 then picked an area, that pick arrived as token 1, and the
// canvas read it as a move it had already made.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  cameraIntentForFocusSource,
  mapCameraFocusKey,
  mapCameraFocusMoves,
  type MapCameraFocus,
} from "@/lib/mapCameraFocus";

const LONDON: [number, number] = [-0.1341, 51.5108];
const CUMBRIA: [number, number] = [-2.3216, 54.5232];

function focus(
  source: MapCameraFocus["source"],
  token: number,
  center: [number, number],
): MapCameraFocus {
  return { center, zoom: 14, source, token };
}

describe("two camera owners can never mint the same identity", () => {
  it("keys a focus by its owner as well as its count", () => {
    expect(mapCameraFocusKey(focus("opening-location", 1, CUMBRIA))).not.toBe(
      mapCameraFocusKey(focus("area", 1, LONDON)),
    );
  });

  it("moves the camera on the captain's journey: locate, then pick an area", () => {
    // 1. The opening location answers and the canvas flies to it.
    const located = focus("opening-location", 1, CUMBRIA);
    expect(mapCameraFocusMoves(located, null)).toBe(true);
    const afterLocate = mapCameraFocusKey(located);

    // 2. The reader picks Piccadilly & Soho. The area lane's own counter also
    //    starts at 1, and this is the move that used to be swallowed.
    const picked = focus("area", 1, LONDON);
    expect(mapCameraFocusMoves(picked, afterLocate)).toBe(true);
  });

  it("still refuses to re-fly the move it has already made", () => {
    const picked = focus("area", 1, LONDON);
    expect(mapCameraFocusMoves(picked, mapCameraFocusKey(picked))).toBe(false);
  });

  it("flies again when the same owner asks a second time", () => {
    const first = focus("area", 1, LONDON);
    const second = focus("area", 2, LONDON);
    expect(mapCameraFocusMoves(second, mapCameraFocusKey(first))).toBe(true);
  });

  it("has nothing to do with no focus at all", () => {
    expect(mapCameraFocusMoves(null, null)).toBe(false);
    expect(mapCameraFocusMoves(undefined, "area:1")).toBe(false);
  });
});

describe("the canvas holds the identity, never a bare number", () => {
  const canvas = readFileSync(
    join(__dirname, "..", "components/PubMapCanvas.tsx"),
    "utf8",
  );

  it("compares through the shared rule", () => {
    expect(canvas).toContain("mapCameraFocusMoves(focusPoint, focusKeyRef.current)");
    // The number-only compare is what let one owner's move look like another's.
    expect(canvas).not.toContain("focusPoint.token === focusTokenRef.current");
  });
});

describe("both camera owners name themselves", () => {
  const pubMap = readFileSync(
    join(__dirname, "..", "components/PubMap.tsx"),
    "utf8",
  );

  it("stamps a source on every focus it mints", () => {
    expect(pubMap).toContain('source: "opening-location"');
    expect(pubMap).toContain('source: "area"');
  });

  it("keeps the area lane as the ONE deliberate move", () => {
    // moveMapCameraTo is the single door the choose-area pick, the Area
    // sheet's "go somewhere else" and a map-search select all go through.
    expect(pubMap).toContain("const moveMapCameraTo = useCallback(");
    expect(pubMap).toContain("setAreaFocus((prev) => ({");
  });
});

// The second half of the same defect, surfaced by MapLibre 6.10.0 readying the
// map early enough that the opening-location answer can fly FIRST.
//
// The canvas counted both owners on ONE camera-intent kind, "area". A reader
// who searched an area then counted two area intents where the product
// promises one, and, because the kind is also the prefix of the camera
// coordinator's dedupe key, an opening-location fly to a view could swallow the
// reader's own pick of the same view inside the dedupe window.
describe("each camera owner rides its own intent lane", () => {
  it("gives the area lane the area intent", () => {
    expect(cameraIntentForFocusSource("area")).toBe("area");
  });

  it("does not let the opening answer count as an area pick", () => {
    expect(cameraIntentForFocusSource("opening-location")).toBe("opening-location");
  });

  it("gives no two owners the same lane", () => {
    const sources: MapCameraFocus["source"][] = ["opening-location", "area"];
    const lanes = sources.map(cameraIntentForFocusSource);
    expect(new Set(lanes).size).toBe(sources.length);
  });

  it("is the rule the canvas asks, rather than a ternary of its own", () => {
    const canvas = readFileSync(
      join(__dirname, "..", "components/PubMapCanvas.tsx"),
      "utf8",
    );
    expect(canvas).toContain("cameraIntentForFocusSource(focusPoint.source)");
  });
});

// The reader's own pick must KEEP the camera afterwards.
//
// The mint effect that re-flies the opening-location answer bails on
// mapCameraTouchedRef, and cancelOpeningLocation cannot set it: that callback
// is a no-op once the location has already resolved
// (openingLocationCancellationAfterAttempt, __tests__/mapFirstUsefulPins.test.ts).
// So the deliberate move has to take the camera itself, exactly as a gesture
// does through dismissAmbientBanners. Without it a later locationFirstMapView
// change re-mints an opening-location focus and yanks the map off the pick.
describe("a deliberate move takes the camera and keeps it", () => {
  const pubMap = readFileSync(
    join(__dirname, "..", "components/PubMap.tsx"),
    "utf8",
  );
  const moveMapCameraTo = (() => {
    const start = pubMap.indexOf("const moveMapCameraTo = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = pubMap.indexOf("[cancelOpeningLocation],", start);
    expect(end).toBeGreaterThan(start);
    return pubMap.slice(start, end);
  })();

  it("marks the camera touched", () => {
    expect(moveMapCameraTo).toContain("mapCameraTouchedRef.current = true");
    expect(moveMapCameraTo).toContain("setMapCameraTouched(true)");
  });

  it("marks it before it asks the cancellation that cannot", () => {
    const touched = moveMapCameraTo.indexOf("mapCameraTouchedRef.current = true");
    const cancelled = moveMapCameraTo.indexOf("cancelOpeningLocation()");
    expect(touched).toBeGreaterThan(-1);
    expect(cancelled).toBeGreaterThan(-1);
    expect(touched).toBeLessThan(cancelled);
  });

  it("drops the opening focus it just overtook", () => {
    expect(moveMapCameraTo).toContain("setOpeningLocationFocus(null)");
  });

  it("is the guard the opening-location mint effect reads", () => {
    const mint = pubMap.slice(pubMap.indexOf('source: "opening-location"') - 1200);
    expect(mint).toContain("mapCameraTouchedRef.current");
  });
});
