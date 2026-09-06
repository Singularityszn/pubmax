import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import * as filters from "@/components/map/canvas/filters";
import {
  PIN_ENTRANCE_SETTLE_CEILING_MS,
  PIN_ENTRANCE_TOTAL_MS,
} from "@/components/map/canvas/tokens";

// A PIN'S SIZE IS ITS HIT BOX, so the entrance may only ever ramp paint.
//
// `icon-size` is a MapLibre LAYOUT property: symbols are PLACED from it and
// queryRenderedFeatures answers from that placement, so an entrance that ramped
// icon-size from 0 made every unselected pin untappable for the whole ramp, and
// rewrote a layout property on every frame of it (a re-placement per frame,
// on the phone least able to afford one). Measured at 1440x900 under a 4x CPU
// throttle on Slow 4G, that ramp took 591 to 1,328 ms against its own 400 ms
// specification, because it advances on RAF ticks and a starved frame budget
// has none to give.
//
// No browser test reproduces a MapLibre placement box, so the fence is the
// source: the entrance frame writes paint and nothing else, and the ramp
// carries a wall clock that ends it whatever the frames did.

const CANVAS_SOURCE = readFileSync(
  path.join(process.cwd(), "components", "PubMapCanvas.tsx"),
  "utf8",
);

function applyPinEntranceFrameBody(): string {
  const start = CANVAS_SOURCE.indexOf("const applyPinEntranceFrame = (");
  expect(start).toBeGreaterThan(-1);
  const end = CANVAS_SOURCE.indexOf("const applyClusterEntranceFrame = (", start);
  expect(end).toBeGreaterThan(start);
  return CANVAS_SOURCE.slice(start, end);
}

describe("the pin entrance never touches a pin's hit box", () => {
  it("writes no layout property while the entrance runs", () => {
    expect(applyPinEntranceFrameBody()).not.toContain("setLayoutProperty");
  });

  it("keeps no icon-size ramp expression to reach for", () => {
    expect(Object.keys(filters)).not.toContain("pinEntranceIconSizeExpr");
  });

  it("ramps icon and text opacity, which are paint", () => {
    const body = applyPinEntranceFrameBody();
    expect(body).toContain('"icon-opacity"');
    expect(body).toContain('"text-opacity"');
  });
});

describe("the ramp cannot outlive the duration it promises", () => {
  it("carries a wall-clock ceiling past its own specified total", () => {
    expect(PIN_ENTRANCE_SETTLE_CEILING_MS).toBeGreaterThan(PIN_ENTRANCE_TOTAL_MS);
  });

  it("arms that ceiling when the entrance starts and clears it when it finishes", () => {
    expect(CANVAS_SOURCE).toContain("PIN_ENTRANCE_SETTLE_CEILING_MS");
    expect(CANVAS_SOURCE).toContain("clearPinEntranceCeiling");
    const finish = CANVAS_SOURCE.slice(
      CANVAS_SOURCE.indexOf("const finishPinEntrance = () => {"),
    );
    expect(finish.slice(0, 200)).toContain("clearPinEntranceCeiling()");
  });
});
