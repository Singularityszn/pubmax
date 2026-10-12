import { describe, expect, it } from "vitest";

import {
  resolveSheetSnap,
  resolveSheetHeightSnap,
  sheetClosedTranslateY,
  sheetSnapCaps,
  sheetTranslateY,
  sheetTranslateYFraction,
  SHEET_SNAP_FRACTIONS,
  SHEET_SNAP_ORDER,
  SHEET_SNAP_TRANSLATE_FRACTIONS,
  deepLinkSelectionCamera,
  mobileSelectCameraOffset,
  SHEET_ENTRANCE_MS,
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

describe("sheetClosedTranslateY", () => {
  it("moves a bottom-offset tablet drawer fully below the viewport", () => {
    expect(sheetClosedTranslateY(800, 58)).toBe(858);
  });

  it("ignores invalid and negative bottom clearances", () => {
    expect(sheetClosedTranslateY(800, -20)).toBe(800);
    expect(sheetClosedTranslateY(800, Number.NaN)).toBe(800);
  });
});

// The phone sheet's entrance used to spring the BOX HEIGHT from a sliver up to
// the snap cap, and `sheetEntranceStartHeight` set that sliver. This sheet is
// bottom-anchored, so that travel moved every pixel inside it and Chrome scored
// the lot: a `/map?sel=` arrival measured CLS 0.31 on the audit's phone rig. The
// entrance is a transform now (components/mobile/mobileMapShell.css,
// `.sheet-entering`), the height is set at once, and the helper is retired.
describe("SHEET_ENTRANCE_MS", () => {
  it("is the one duration the entrance class and its keyframes share", () => {
    expect(SHEET_ENTRANCE_MS).toBeGreaterThan(0);
  });
});

describe("mobileSelectCameraOffset", () => {
  // MapLibre draws the requested centre at the container centre PLUS the
  // offset, and screen Y grows downward. A positive Y therefore pushed the pin
  // DOWN, under the sheet - the exact defect this function exists to prevent,
  // measured live on a 390x844 phone as a deep-linked pin at y 654 with the
  // sheet's top edge at 316.
  it("offsets UPWARD so the pin sits in the visible band above a half sheet", () => {
    const [x, y] = mobileSelectCameraOffset(VH, "half");
    expect(x).toBe(0);
    // Visible mid ≈ (1 - 0.55) / 2 = 0.225 from top → offset ≈ -0.275 * VH
    expect(y).toBe(Math.round(((1 - SHEET_SNAP_FRACTIONS.half) / 2 - 0.5) * VH));
    expect(y).toBeLessThan(0);
  });

  it("lands the pin in the band above the sheet, not under it", () => {
    const height = 844;
    const sheetTop = 316;
    const [, y] = mobileSelectCameraOffset(height, "half", sheetTop);
    // Where the pin is painted: the container centre, moved by the offset.
    const pinY = height / 2 + y;
    expect(pinY).toBeGreaterThan(0);
    expect(pinY).toBeLessThan(sheetTop);
  });

  it("takes a measured sheet edge only when it raises the pin", () => {
    const height = 844;
    const fallback = mobileSelectCameraOffset(height, "half")[1];
    // A taller sheet than the snap fraction implies: trust the measurement.
    const taller = mobileSelectCameraOffset(height, "half", 300)[1];
    expect(taller).toBeLessThan(fallback);
    // A sheet still springing open reports an edge near the bottom of the
    // screen. Trusting it would park the pin where the settled sheet lands, so
    // the snap fraction stands instead.
    const midSpring = mobileSelectCameraOffset(height, "half", 800)[1];
    expect(midSpring).toBe(fallback);
  });

  it("never offsets downward, whatever it is handed", () => {
    for (const sheetTop of [1, 40, 844, 5000]) {
      expect(mobileSelectCameraOffset(844, "half", sheetTop)[1]).toBeLessThanOrEqual(0);
    }
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

describe("resolveSheetSnap — projected momentum", () => {
  it("a fast upward flick from peek can project through half to full", () => {
    const result = resolveSheetSnap({
      currentSnap: "peek",
      viewportHeight: VH,
      dragDeltaY: -10, // barely moved
      velocity: -1.2, // fast upward flick (negative = up)
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
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

  it("a fast downward flick from half lands at peek instead of dismissing", () => {
    const result = resolveSheetSnap({
      currentSnap: "half",
      viewportHeight: VH,
      dragDeltaY: 10,
      velocity: 0.8,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
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

// The rebuilt phone portal sheet is bottom-anchored with a content-driven height
// capped by the snap's fraction of the viewport. The void is killed in CSS
// (height:auto; max-height:cap), so the only pure logic left is (a) the per-snap
// cap heights and (b) the height-drag → snap resolver.
describe("sheetSnapCaps — per-snap cap heights (bottom-anchored model)", () => {
  it("is the snap fraction of the viewport minus the bottom dock clearance", () => {
    const caps = sheetSnapCaps(800, 0);
    expect(caps.peek).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.peek);
    expect(caps.half).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.half);
    expect(caps.full).toBeCloseTo(800 * SHEET_SNAP_FRACTIONS.full);
    // full > half > peek, mirroring the ordered snaps.
    expect(caps.full).toBeGreaterThan(caps.half);
    expect(caps.half).toBeGreaterThan(caps.peek);
  });

  it("takes the dock clearance from full alone, keeping its top edge, and never goes negative", () => {
    const caps = sheetSnapCaps(844, 98);
    expect(caps.peek).toBeCloseTo(844 * SHEET_SNAP_FRACTIONS.peek);
    expect(caps.half).toBeCloseTo(844 * SHEET_SNAP_FRACTIONS.half);
    expect(844 - 98 - caps.full).toBeCloseTo(844 * (1 - SHEET_SNAP_FRACTIONS.full));
    expect(sheetSnapCaps(800, 100_000).full).toBe(0);
  });

  it("never rests peek or half below the sheet's own header and footer", () => {
    const caps = sheetSnapCaps(568, 64, 201);
    expect(caps.peek).toBe(201);
    expect(caps.half).toBeCloseTo(568 * SHEET_SNAP_FRACTIONS.half);
    expect(caps.full).toBeCloseTo(568 * SHEET_SNAP_FRACTIONS.full - 64);
  });
});

describe("resolveSheetHeightSnap — no-velocity (nearest neighbour on height)", () => {
  const caps = sheetSnapCaps(800, 0); // peek 176, half 440, full 736

  it("stays at the same snap when there is no drag (start height = its cap)", () => {
    for (const snap of SHEET_SNAP_ORDER) {
      const result = resolveSheetHeightSnap({
        viewportHeight: VH,
        startSnap: snap,
        startHeightPx: caps[snap],
        releaseHeightPx: caps[snap],
        velocity: 0,
        caps,
      });
      expect(result).toEqual({ snap, dismissed: false });
    }
  });

  it("keeps a SHORT content-hugged half at half, not peek (start height in peek's band)", () => {
    // A hugged half sheet renders far shorter than half's cap — even shorter than
    // peek's cap. Absolute nearest-cap would mis-snap it to peek; the start-height
    // reference keeps a still finger on half.
    const hugged = 120; // < caps.peek (176)
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "half",
      startHeightPx: hugged,
      releaseHeightPx: hugged,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("resolves to full when dragged up from half toward the full cap", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: caps.full,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("resolves to half when dragged down from full toward the half cap", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.half,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("dismisses when collapsed well below peek without a flick", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek * 0.4, // below the half-a-peek dismiss line
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("does not dismiss on a small downward nudge from peek", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek - 5,
      velocity: 0,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });
});

describe("resolveSheetHeightSnap physical-dismiss threshold", () => {
  it("dismisses the established phone drag despite a shorter command-bar peek", () => {
    const caps = { ...sheetSnapCaps(844, 98), peek: 135 };
    expect(resolveSheetHeightSnap({
      viewportHeight: 844,
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: 844 * 0.11 - 24,
      velocity: 0,
      caps,
    })).toEqual({ snap: "peek", dismissed: true });
  });

  it("keeps a short viewport open when a taller command bar would move the dismissal line", () => {
    const caps = { ...sheetSnapCaps(568, 64), peek: 185 };
    expect(resolveSheetHeightSnap({
      viewportHeight: 568,
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: 80,
      velocity: 0,
      caps,
    })).toEqual({ snap: "peek", dismissed: false });
  });
});

describe("resolveSheetHeightSnap — projected momentum", () => {
  const caps = sheetSnapCaps(800, 0);

  it("a fast upward flick from peek can project through half to full", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek + 10, // barely grew
      velocity: 1.2, // fast growth (positive = up)
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from half jumps to full", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: caps.half + 10,
      velocity: 0.9,
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast upward flick from full stays at full (already the max)", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.full + 10,
      velocity: 0.8,
      caps,
    });
    expect(result).toEqual({ snap: "full", dismissed: false });
  });

  it("a fast downward flick from full drops to half, not all the way to peek", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.full - 10,
      velocity: -0.8, // shrinking fast (negative = down)
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });

  it("a fast downward drag from half lands at peek instead of dismissing", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "half",
      startHeightPx: caps.half,
      releaseHeightPx: caps.half - 260,
      velocity: -0.8,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: false });
  });

  it("a fast downward flick from peek dismisses the sheet", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "peek",
      startHeightPx: caps.peek,
      releaseHeightPx: caps.peek - 10,
      velocity: -0.8,
      caps,
    });
    expect(result).toEqual({ snap: "peek", dismissed: true });
  });

  it("a slow release just under the flick threshold uses nearest-neighbour, not the flick rule", () => {
    const result = resolveSheetHeightSnap({
      viewportHeight: VH,
      startSnap: "full",
      startHeightPx: caps.full,
      releaseHeightPx: caps.half,
      velocity: -0.49, // just below the 0.5 px/ms threshold
      caps,
    });
    expect(result).toEqual({ snap: "half", dismissed: false });
  });
});


describe("deepLinkSelectionCamera", () => {
  it("measures the sheet for the venue a link named", () => {
    expect(
      deepLinkSelectionCamera({
        arrivalVenueId: "venue-alias",
        selectedVenueId: "venue-alias",
        cameraSpent: false,
      }),
    ).toEqual({ measureSheet: true, arrivalVenueId: "venue-alias" });
  });

  it("still measures after the arrival id is rewritten to its canonical form", () => {
    const rewritten = deepLinkSelectionCamera({
      arrivalVenueId: "venue-alias",
      selectedVenueId: "venue-canonical",
      cameraSpent: false,
    });
    expect(rewritten).toEqual({
      measureSheet: true,
      arrivalVenueId: "venue-canonical",
    });
    expect(
      deepLinkSelectionCamera({
        arrivalVenueId: rewritten.arrivalVenueId,
        selectedVenueId: "venue-canonical",
        cameraSpent: false,
      }).measureSheet,
    ).toBe(true);
  });

  it("moves at once once the camera has moved for a selection", () => {
    expect(
      deepLinkSelectionCamera({
        arrivalVenueId: "venue-canonical",
        selectedVenueId: "venue-other",
        cameraSpent: true,
      }),
    ).toEqual({ measureSheet: false, arrivalVenueId: "venue-canonical" });
  });

  it("moves at once for an arrival that named no venue", () => {
    expect(
      deepLinkSelectionCamera({
        arrivalVenueId: "",
        selectedVenueId: "venue-tapped",
        cameraSpent: false,
      }),
    ).toEqual({ measureSheet: false, arrivalVenueId: "" });
  });
});
