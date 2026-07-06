import { describe, expect, it } from "vitest";

import {
  resolveSheetSnap,
  sheetTranslateY,
  SHEET_SNAP_FRACTIONS,
  SHEET_SNAP_ORDER,
} from "@/lib/sheetSnap";

const VH = 800; // a plausible phone viewport height in px

describe("sheetTranslateY", () => {
  it("returns a larger translateY (more hidden) for smaller snaps", () => {
    const peekY = sheetTranslateY("peek", VH);
    const halfY = sheetTranslateY("half", VH);
    const fullY = sheetTranslateY("full", VH);
    expect(peekY).toBeGreaterThan(halfY);
    expect(halfY).toBeGreaterThan(fullY);
  });

  it("matches the documented vh fractions", () => {
    expect(sheetTranslateY("full", VH)).toBeCloseTo(VH * (1 - SHEET_SNAP_FRACTIONS.full));
    expect(sheetTranslateY("half", VH)).toBeCloseTo(VH * (1 - SHEET_SNAP_FRACTIONS.half));
    expect(sheetTranslateY("peek", VH)).toBeCloseTo(VH * (1 - SHEET_SNAP_FRACTIONS.peek));
  });
});

describe("resolveSheetSnap — no-velocity (nearest neighbour)", () => {
  it("stays at the same snap when there is no drag", () => {
    for (const snap of SHEET_SNAP_ORDER) {
      const result = resolveSheetSnap({
        currentSnap: snap,
        viewportHeight: VH,
        dragDeltaY: 0,
        velocity: 0,
      });
      expect(result).toEqual({ snap, dismissed: false });
    }
  });

  it("resolves to half when dragged from full roughly halfway down", () => {
    const fullY = sheetTranslateY("full", VH);
    const halfY = sheetTranslateY("half", VH);
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: halfY - fullY,
      velocity: 0,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("resolves to full when dragged up from half toward full", () => {
    const fullY = sheetTranslateY("full", VH);
    const halfY = sheetTranslateY("half", VH);
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: VH,
      dragDeltaY: fullY - halfY,
      velocity: 0,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("dismisses when dragged well below peek without a flick", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: VH, // dragged the sheet fully off-screen, slowly
      velocity: 0,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("does not dismiss on a small downward nudge from peek", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: 5,
      velocity: 0,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });
});

describe("resolveSheetSnap — flick (velocity-driven overshoot)", () => {
  it("a fast upward flick from peek jumps to half, not full, in one step", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: -10, // barely moved
      velocity: -1.2, // fast upward flick (negative = up)
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("a fast upward flick from half jumps to full", () => {
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: VH,
      dragDeltaY: -10,
      velocity: -0.9,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from full stays at full (already the max)", () => {
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: -10,
      velocity: -0.8,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast downward flick from full drops to half, not all the way to peek", () => {
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: 10,
      velocity: 0.8,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("a fast downward flick from peek dismisses the sheet", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: 10,
      velocity: 0.8,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("a slow release just under the flick threshold uses nearest-neighbour, not the flick rule", () => {
    const fullY = sheetTranslateY("full", VH);
    const halfY = sheetTranslateY("half", VH);
    const result = resolveSheetSnap({
      currentSnap: "full",
      viewportHeight: VH,
      dragDeltaY: halfY - fullY,
      velocity: 0.49, // just below the 0.5 px/ms threshold
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });
});

describe("resolveSheetSnap — edge cases", () => {
  it("returns the current snap unchanged when viewportHeight is not positive", () => {
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: 0,
      dragDeltaY: 200,
      velocity: 2,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });
});
