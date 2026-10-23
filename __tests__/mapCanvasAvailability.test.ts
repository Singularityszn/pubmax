import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAP_CANVAS_READINESS_CEILING_MS,
  MAP_CANVAS_RETRY_LABEL,
  mapCanvasAvailability,
  mapCanvasCeilingArmed,
  mapCanvasFrameReleased,
  mapCanvasSlotState,
  mapCanvasUnavailableHeading,
  mapCanvasUnavailableLine,
  type MapCanvasReadinessState,
} from "@/lib/mapCanvasAvailability";
import { defined } from "@/__tests__/helpers/defined";

const SILENT: MapCanvasReadinessState = {
  moduleFailed: false,
  canvasOwnsFailure: false,
  canvasReady: false,
  ceilingLapsed: false,
};

function state(patch: Partial<MapCanvasReadinessState>): MapCanvasReadinessState {
  return { ...SILENT, ...patch };
}

describe("map canvas availability", () => {
  it("waits while a mounted canvas has said nothing yet", () => {
    expect(mapCanvasAvailability(SILENT)).toEqual({ status: "loading" });
    expect(mapCanvasFrameReleased(mapCanvasAvailability(SILENT))).toBe(false);
  });

  it("is ready once the canvas publishes a ready map", () => {
    expect(mapCanvasAvailability(state({ canvasReady: true }))).toEqual({
      status: "ready",
    });
  });

  it("answers module for a canvas whose own code never arrived", () => {
    expect(mapCanvasAvailability(state({ moduleFailed: true }))).toEqual({
      status: "unavailable",
      reason: "module",
    });
  });

  it("keeps answering module however loud the rest of the page gets", () => {
    // A module failure is the strongest fact there is: no canvas exists to
    // paint a pin, so no later signal may talk over it.
    expect(
      mapCanvasAvailability(
        state({ moduleFailed: true, canvasReady: true, ceilingLapsed: true }),
      ),
    ).toEqual({ status: "unavailable", reason: "module" });
  });

  it("answers timeout only once the ceiling lapses on a silent canvas", () => {
    expect(mapCanvasAvailability(state({ ceilingLapsed: true }))).toEqual({
      status: "unavailable",
      reason: "timeout",
    });
  });

  it("lets a map that arrived late be a map", () => {
    expect(
      mapCanvasAvailability(state({ ceilingLapsed: true, canvasReady: true })),
    ).toEqual({ status: "ready" });
  });

  it("never talks over a canvas showing its own failure card", () => {
    // The canvas diagnoses WHY, and its card carries that reason. A vaguer
    // shell notice on top of it would blame the wrong thing.
    expect(
      mapCanvasAvailability(state({ canvasOwnsFailure: true, ceilingLapsed: true })),
    ).toEqual({ status: "ready" });
  });

  it("runs the ceiling from mount until the canvas answers, and no longer", () => {
    const silent = {
      moduleFailed: false,
      canvasOwnsFailure: false,
      canvasReady: false,
      canvasWatching: false,
    };
    expect(mapCanvasCeilingArmed(silent)).toBe(true);
    expect(mapCanvasCeilingArmed({ ...silent, canvasReady: true })).toBe(false);
    expect(mapCanvasCeilingArmed({ ...silent, moduleFailed: true })).toBe(false);
    expect(mapCanvasCeilingArmed({ ...silent, canvasOwnsFailure: true })).toBe(false);
  });

  it("stands down once the canvas has built its map and watches itself", () => {
    // The canvas's own scene-ready guard is 18 s from construction, which is
    // later than this ceiling's 18 s from mount. Left running, the shell won
    // that race and unmounted a map whose scene was queued for its next frame.
    expect(
      mapCanvasCeilingArmed({
        moduleFailed: false,
        canvasOwnsFailure: false,
        canvasReady: false,
        canvasWatching: true,
      }),
    ).toBe(false);
  });

  it("releases the held frame for both unavailable answers and for nothing else", () => {
    for (const s of [state({ moduleFailed: true }), state({ ceilingLapsed: true })]) {
      expect(mapCanvasFrameReleased(mapCanvasAvailability(s))).toBe(true);
    }
    for (const s of [SILENT, state({ canvasReady: true })]) {
      expect(mapCanvasFrameReleased(mapCanvasAvailability(s))).toBe(false);
    }
  });

  it("names the slot so a browser test reads the decision, not the paint", () => {
    expect(mapCanvasSlotState(mapCanvasAvailability(SILENT))).toBe("loading");
    expect(mapCanvasSlotState(mapCanvasAvailability(state({ canvasReady: true })))).toBe(
      "ready",
    );
    expect(mapCanvasSlotState(mapCanvasAvailability(state({ moduleFailed: true })))).toBe(
      "unavailable-module",
    );
    expect(
      mapCanvasSlotState(mapCanvasAvailability(state({ ceilingLapsed: true }))),
    ).toBe("unavailable-timeout");
  });
});

describe("map canvas unavailable copy", () => {
  it("names each cause apart and never blames the reader's browser", () => {
    expect(mapCanvasUnavailableHeading("module")).toBe("Map couldn't load");
    expect(mapCanvasUnavailableHeading("timeout")).toBe("Map didn't finish loading");
    expect(mapCanvasUnavailableHeading("module")).not.toBe(
      mapCanvasUnavailableHeading("timeout"),
    );
    for (const reason of ["module", "timeout"] as const) {
      expect(mapCanvasUnavailableLine(reason)).not.toMatch(/webgl|your browser|your connection/i);
    }
  });

  it("says what still works, in the house voice", () => {
    for (const reason of ["module", "timeout"] as const) {
      const line = mapCanvasUnavailableLine(reason);
      expect(line).toContain("still work as ever");
      // docs/VOICE.md: no closed doors, no em dash.
      expect(line).not.toMatch(/please try again|try again later|check back later/i);
      expect(line).not.toContain("—");
    }
  });

  it("spends the same word the canvas's own card spends", () => {
    expect(MAP_CANVAS_RETRY_LABEL).toBe("Retry");
  });
});

describe("the readiness ceiling", () => {
  // A mounted canvas must always get to name its own failure first, so this
  // ceiling has to outlast every watchdog inside the canvas. Read those two
  // numbers out of the canvas itself rather than restating them, or the day one
  // of them is raised this rule quietly stops holding.
  const canvasSource = readFileSync(
    path.join(process.cwd(), "components/PubMapCanvas.tsx"),
    "utf8",
  );

  function canvasConstant(name: string): number {
    const match = canvasSource.match(
      new RegExp(`const ${name} = ([0-9_]+);`),
    );
    expect(match, `${name} is no longer a literal in PubMapCanvas`).not.toBeNull();
    return Number(defined(match![1]).replace(/_/g, ""));
  }

  it("sits above the canvas's own pin-ready ceiling", () => {
    expect(MAP_CANVAS_READINESS_CEILING_MS).toBeGreaterThan(
      canvasConstant("PIN_READY_CEILING_MS"),
    );
  });

  it("sits above the canvas's own first-frame watchdog", () => {
    expect(MAP_CANVAS_READINESS_CEILING_MS).toBeGreaterThan(
      canvasConstant("FIRST_FRAME_TIMEOUT_MS"),
    );
  });

  it("stays bounded, because an unbounded one is the defect it replaces", () => {
    expect(Number.isFinite(MAP_CANVAS_READINESS_CEILING_MS)).toBe(true);
    expect(MAP_CANVAS_READINESS_CEILING_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("the shell wiring", () => {
  const shell = readFileSync(path.join(process.cwd(), "components/PubMap.tsx"), "utf8");

  it("catches the canvas subtree so a blocked chunk cannot take the page", () => {
    expect(shell).toContain("class MapCanvasBoundary");
    expect(shell).toContain("<MapCanvasBoundary");
  });

  it("builds a fresh lazy component per attempt, because a rejected one stays rejected", () => {
    expect(shell).toContain("pubMapCanvasForAttempt");
    expect(shell).toContain("pubMapCanvasByAttempt");
  });

  it("owns the stylesheet for the selection notice markup it renders itself", () => {
    // The note for a bad `?sel=` used to arrive unstyled, because
    // ukPlaceArrivalBanner.css shipped only with two dynamically imported
    // banners that a bad id never mounts.
    expect(shell).toContain('import "@/components/map/ukPlaceArrivalBanner.css"');
    expect(shell).toContain('className="ukPlaceArrival"');
  });

  it("shows the map's ONE venue view where the canvas would be", () => {
    expect(shell).toContain("MapFallbackCard");
    expect(shell).not.toContain('className="mapFallbackVenue"');
  });
});
