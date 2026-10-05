import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { MAP_CANVAS_READINESS_CEILING_MS } from "@/lib/mapCanvasAvailability";
import {
  HELD_MAP_SECONDARY_STREAMS,
  MAP_SECONDARY_STREAM_HOLD_CEILING_MS,
  mapSecondaryStreamsHeld,
} from "@/lib/mapFirstPinStreams";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("mapSecondaryStreamsHeld", () => {
  const held = {
    pinsRevealed: false,
    canvasUnavailable: false,
    holdCeilingLapsed: false,
  };

  it("holds the sides while the pins have not painted", () => {
    expect(mapSecondaryStreamsHeld(held)).toBe(true);
  });

  it("releases the moment the canvas announces a painted pin", () => {
    expect(mapSecondaryStreamsHeld({ ...held, pinsRevealed: true })).toBe(false);
  });

  it("releases when the shell has decided there is no canvas at all", () => {
    // The F08 lane: nothing will ever announce a painted pin, so a hold that
    // waited for one would starve the fallback card's own venue rows.
    expect(mapSecondaryStreamsHeld({ ...held, canvasUnavailable: true })).toBe(
      false,
    );
  });

  it("releases on its own ceiling, so a hold is never a cage", () => {
    expect(mapSecondaryStreamsHeld({ ...held, holdCeilingLapsed: true })).toBe(
      false,
    );
  });
});

describe("the hold's ceiling", () => {
  it("is derived from the shell's own patience for a canvas, never typed", () => {
    expect(MAP_SECONDARY_STREAM_HOLD_CEILING_MS).toBe(
      MAP_CANVAS_READINESS_CEILING_MS,
    );
    expect(read("lib/mapFirstPinStreams.ts")).toContain(
      "MAP_SECONDARY_STREAM_HOLD_CEILING_MS = MAP_CANVAS_READINESS_CEILING_MS",
    );
  });
});

describe("the closed set of held lanes", () => {
  it("names exactly the four lanes the rule holds", () => {
    expect([...HELD_MAP_SECONDARY_STREAMS]).toEqual([
      "slim-shard-rings",
      "uk-base-layer",
      "ambient-poi-overlay",
      "london-restaurant-pack",
    ]);
  });

  it("holds the slim shard rings at the one door every ring load comes through", () => {
    const source = read("components/PubMap.tsx");
    // The guard sits at the TOP of scheduleRingLoad, before the pending-key
    // dedupe, so a ring asked for while the hold is on is remembered rather
    // than banked against a key that would then refuse the retry.
    const guard = source.indexOf("if (secondaryStreamsHeldRef.current) {");
    const dedupe = source.indexOf(
      "if (ringLoadPendingKeyRef.current === key) return;",
    );
    expect(guard).toBeGreaterThan(-1);
    expect(dedupe).toBeGreaterThan(guard);
    expect(source).toContain("heldRingLoadRef.current = { loader, bounds };");
    expect(source).toContain("scheduleRingLoad(held.loader, bounds);");
  });

  it("holds the UK base layer without emptying it, which is what suspension means", () => {
    const source = read("components/map/pubmap/useUkBaseStreaming.ts");
    // The hold sits BELOW the camera question: a held lane still answers
    // `zoom_required`, because that answer costs no fetch and is true. Only
    // the fetch waits.
    const cameraAnswer = source.indexOf(
      'publish([], suspended ? "suspended" : "zoom_required");',
    );
    const holdGuard = source.indexOf("if (held) return;");
    expect(cameraAnswer).toBeGreaterThan(-1);
    expect(holdGuard).toBeGreaterThan(cameraAnswer);
    // A held lane keeps its `loading` answer; only `suspended` empties it.
    expect(source).not.toContain("publish([], held ?");
    expect(read("components/PubMapCanvas.tsx")).toContain(
      "held: secondaryStreamsHeld,",
    );
  });

  it("holds the ambient POI read behind the same one answer", () => {
    const source = read("components/PubMapCanvas.tsx");
    expect(source).toContain("if (secondaryStreamsHeld) return;");
    expect(source).toContain(
      "}, [mapReady, applyToMap, poisPath, secondaryStreamsHeld]);",
    );
  });
});

describe("one owner", () => {
  it("derives the answer in PubMap alone and hands the canvas a prop", () => {
    const owner = read("components/PubMap.tsx");
    const canvas = read("components/PubMapCanvas.tsx");
    expect(owner).toContain("useMapSecondaryStreamHold({");
    expect(owner).toContain("secondaryStreamsHeld={secondaryStreamsHeld}");
    // The canvas must not keep a second copy of the rule.
    expect(canvas).not.toContain("useMapSecondaryStreamHold");
    expect(canvas).not.toContain("mapSecondaryStreamsHeld");
  });

  it("never re-holds after a lapse, so a canvas retry cannot restart the wait", () => {
    expect(read("components/map/useMapSecondaryStreamHold.ts")).toContain(
      "if (holdCeilingLapsed) return;",
    );
  });
});
