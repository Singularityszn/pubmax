import { describe, expect, it } from "vitest";

import {
  resolveSheetSnap,
  resolveHalfContentFit,
  sheetTranslateY,
  sheetTranslateYFraction,
  SHEET_SNAP_FRACTIONS,
  SHEET_SNAP_ORDER,
  SHEET_SNAP_TRANSLATE_FRACTIONS,
  mobileSelectCameraOffset,
} from "@/lib/sheetSnap";

const VH = 800; // a plausible phone viewport height in px

describe("SHEET_SNAP_TRANSLATE_FRACTIONS", () => {
  it("is 1 − revealed fraction for every snap (CSS vh source of truth)", () => {
    expect(SHEET_SNAP_TRANSLATE_FRACTIONS.full).toBeCloseTo(0.08);
    expect(SHEET_SNAP_TRANSLATE_FRACTIONS.half).toBeCloseTo(0.45);
    expect(SHEET_SNAP_TRANSLATE_FRACTIONS.peek).toBeCloseTo(0.78);
    for (const snap of SHEET_SNAP_ORDER) {
      expect(SHEET_SNAP_TRANSLATE_FRACTIONS[snap]).toBeCloseTo(
        1 - SHEET_SNAP_FRACTIONS[snap],
      );
      expect(sheetTranslateYFraction(snap)).toBe(SHEET_SNAP_TRANSLATE_FRACTIONS[snap]);
    }
  });
});

describe("sheetTranslateY", () => {
  it("returns a larger translateY (more hidden) for smaller snaps", () => {
    const peekY = sheetTranslateY("peek", VH);
    const halfY = sheetTranslateY("half", VH);
    const fullY = sheetTranslateY("full", VH);
    expect(peekY).toBeGreaterThan(halfY);
    expect(halfY).toBeGreaterThan(fullY);
  });

  it("matches the documented vh fractions", () => {
    expect(sheetTranslateY("full", VH)).toBeCloseTo(VH * SHEET_SNAP_TRANSLATE_FRACTIONS.full);
    expect(sheetTranslateY("half", VH)).toBeCloseTo(VH * SHEET_SNAP_TRANSLATE_FRACTIONS.half);
    expect(sheetTranslateY("peek", VH)).toBeCloseTo(VH * SHEET_SNAP_TRANSLATE_FRACTIONS.peek);
  });
});

describe("mobileSelectCameraOffset", () => {
  it("offsets downward so the pin sits in the visible band above a half sheet", () => {
    const [x, y] = mobileSelectCameraOffset(VH, "half");
    expect(x).toBe(0);
    // Visible mid ≈ (1 - 0.55) / 2 = 0.225 from top → offset ≈ 0.275 * VH
    expect(y).toBe(Math.round((0.5 - (1 - SHEET_SNAP_FRACTIONS.half) / 2) * VH));
    expect(y).toBeGreaterThan(0);
  });

  it("returns [0,0] for invalid heights", () => {
    expect(mobileSelectCameraOffset(0)).toEqual([0, 0]);
    expect(mobileSelectCameraOffset(-10)).toEqual([0, 0]);
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

describe("resolveHalfContentFit — content-aware half detent (void killer)", () => {
  const VH = 844; // iPhone 14/15 logical height
  const HEADER = 64;
  const DOCK = 120;

  it("hugs short content: pins body to content and anchors it above the dock", () => {
    const contentHeight = 140; // one small card
    const fit = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight });
    expect(fit).not.toBeNull();
    expect(fit!.bodyPx).toBe(contentHeight);
    // Content bottom lands exactly `DOCK` above the viewport bottom.
    expect(fit!.translatePx).toBe(Math.round(VH - HEADER - contentHeight - DOCK));
    // Revealed height (header + body + dock) never exceeds the half snap.
    const revealed = HEADER + fit!.bodyPx + DOCK;
    expect(revealed).toBeLessThanOrEqual(VH * SHEET_SNAP_FRACTIONS.half + 0.5);
  });

  it("sits LOWER than the plain half snap, so a short sheet is smaller not taller", () => {
    const fit = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: 140 });
    expect(fit!.translatePx).toBeGreaterThan(sheetTranslateY("half", VH));
  });

  it("returns null when content is as tall as (or taller than) the half body", () => {
    const halfBody = VH * SHEET_SNAP_FRACTIONS.half - HEADER - DOCK;
    expect(
      resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: halfBody }),
    ).toBeNull();
    expect(
      resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: halfBody + 400 }),
    ).toBeNull();
  });

  it("returns null for degenerate inputs (no viewport, no content)", () => {
    expect(resolveHalfContentFit({ viewportHeight: 0, headerHeight: HEADER, dockClearance: DOCK, contentHeight: 100 })).toBeNull();
    expect(resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: 0 })).toBeNull();
  });

  it("footerHeight of 0 is identical to omitting it (contextual sheets unchanged)", () => {
    const plain = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: 140 });
    const zeroFooter = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: 140, footerHeight: 0 });
    expect(zeroFooter).toEqual(plain);
  });
});

// Owner ruling (2026-07-23): the venue sheet reserves a fixed Drop/Share command
// bar (--venue-cmdbar-h) below the scroll body. A short venue sheet hugs its
// content and the docked bar rides at the content's bottom — no void.
describe("resolveHalfContentFit — venue footer (docked command bar)", () => {
  const VH = 844;
  const HEADER = 64;
  const DOCK = 120;
  const FOOTER = 72; // --venue-cmdbar-h

  it("lifts the hugged sheet by the footer height so the BAR (not the body) sits above the dock", () => {
    const contentHeight = 140;
    const withFooter = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight, footerHeight: FOOTER });
    expect(withFooter).not.toBeNull();
    expect(withFooter!.bodyPx).toBe(contentHeight);
    // translate = VH − header − content − footer − dock: the whole stack
    // (header + body + footer + dock) lands flush at the viewport bottom.
    expect(withFooter!.translatePx).toBe(Math.round(VH - HEADER - contentHeight - FOOTER - DOCK));
    // The docked bar's bottom (derived by the caller as translate + dock) leaves
    // exactly `dock` between the bar and the screen edge, and the bar's top meets
    // the body's bottom — no gap, no void.
    const barBottom = withFooter!.translatePx + DOCK;
    const bodyBottomFromSheetTop = HEADER + withFooter!.bodyPx;
    const barTopFromSheetTop = VH - barBottom - FOOTER;
    expect(barTopFromSheetTop).toBe(bodyBottomFromSheetTop);
  });

  it("sits higher (smaller translate) than the footerless fit — the footer eats into the room", () => {
    const contentHeight = 140;
    const noFooter = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight });
    const withFooter = resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight, footerHeight: FOOTER });
    expect(withFooter!.translatePx).toBe(noFooter!.translatePx - FOOTER);
  });

  it("returns null (tall content → normal half detent) when content fills the footer-shortened body", () => {
    const halfBodyWithFooter = VH * SHEET_SNAP_FRACTIONS.half - HEADER - DOCK - FOOTER;
    expect(
      resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: halfBodyWithFooter, footerHeight: FOOTER }),
    ).toBeNull();
  });

  it("content that would fit WITHOUT a footer can become tall (null) once the footer reserve is counted", () => {
    // Between the footerless and footered thresholds: hugs plain, but fills once
    // the 72px bar is reserved — proving the footer genuinely shortens the room.
    const halfBodyNoFooter = VH * SHEET_SNAP_FRACTIONS.half - HEADER - DOCK;
    const between = halfBodyNoFooter - FOOTER / 2;
    expect(resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: between })).not.toBeNull();
    expect(
      resolveHalfContentFit({ viewportHeight: VH, headerHeight: HEADER, dockClearance: DOCK, contentHeight: between, footerHeight: FOOTER }),
    ).toBeNull();
  });
});
