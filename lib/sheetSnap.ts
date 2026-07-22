// Pure snap-point resolver for the mobile venue bottom-sheet (GH #17).
//
// The sheet only has three resting states — never a continuous free-float —
// so a drag always resolves to exactly one of them:
//   peek: grabber + title + price visible, everything else tucked below the
//         fold (a small, thumb-friendly sliver of the sheet).
//   half: ~55% of the viewport height — enough to read a tab's content
//         without covering the whole map.
//   full: ~92% of the viewport height — full detail, still leaves a strip of
//         map visible up top so the sheet never feels like a full takeover.
//
// Snap points are expressed as a fraction of the viewport height (vh) so the
// resolver doesn't need to know actual pixel heights of viewport or sheet —
// callers convert to px against their own measured viewport height.
export const SHEET_SNAP_FRACTIONS = {
  peek: 0.22,
  half: 0.55,
  full: 0.92,
} as const;

export type SheetSnap = keyof typeof SHEET_SNAP_FRACTIONS;

// Ordered peek → full so callers can walk "the next snap up/down".
export const SHEET_SNAP_ORDER: SheetSnap[] = ["peek", "half", "full"];

/**
 * MapLibre easeTo `offset` (px) so a selected pub sits in the visible map band
 * above the mobile bottom sheet — not under it. Positive Y moves the camera
 * center down, so the target appears higher on screen.
 *
 * Default assumes the sheet opens at `half` (selectVenue always does).
 */
export function mobileSelectCameraOffset(
  viewportHeight: number,
  snap: SheetSnap = "half",
): [number, number] {
  const h = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  if (h <= 0) return [0, 0];
  // Midpoint of the uncovered band (0 … 1 - sheetFraction).
  const visibleMid = (1 - SHEET_SNAP_FRACTIONS[snap]) / 2;
  const y = Math.round((0.5 - visibleMid) * h);
  return [0, Math.max(0, y)];
}

/**
 * Resting translateY as a fraction of viewport height (DOWN from a full-
 * viewport-tall sheet at translateY(0)). Derived from SHEET_SNAP_FRACTIONS so
 * CSS (`Nv h`), drag px offsets, and resolveSheetSnap all share one source:
 *   translateFraction = 1 - revealedFraction
 *   → full 0.08, half 0.45, peek 0.86
 */
export const SHEET_SNAP_TRANSLATE_FRACTIONS = {
  peek: 1 - SHEET_SNAP_FRACTIONS.peek,
  half: 1 - SHEET_SNAP_FRACTIONS.half,
  full: 1 - SHEET_SNAP_FRACTIONS.full,
} as const;

/** translateY fraction of viewport for a snap (same units as CSS `vh`). */
export function sheetTranslateYFraction(snap: SheetSnap): number {
  return SHEET_SNAP_TRANSLATE_FRACTIONS[snap];
}

// A flick faster than this (px/ms, i.e. px per millisecond) is treated as a
// deliberate gesture that should move at least one snap step beyond the
// nearest-by-distance snap, in the direction of the flick — not just settle
// wherever the finger happened to stop.
const VELOCITY_FLICK_THRESHOLD = 0.5;

export type ResolveSnapInput = {
  /** Current open snap the drag started from. */
  currentSnap: SheetSnap;
  /** Viewport height in px, used to turn the vh fractions into px targets. */
  viewportHeight: number;
  /**
   * Net vertical drag distance in px at release, POSITIVE = dragged down
   * (toward closed), NEGATIVE = dragged up (toward full).
   */
  dragDeltaY: number;
  /**
   * Signed velocity in px/ms at release (same sign convention as dragDeltaY).
   * Pass 0 for a slow/no-velocity release.
   */
  velocity: number;
};

export type ResolveSnapResult = {
  snap: SheetSnap;
  /** True when the resolved result is "closed" — dragged down past peek. */
  dismissed: boolean;
};

function snapToY(snap: SheetSnap, viewportHeight: number): number {
  // Sheet is modeled as viewport-tall; translateY pushes it down so only
  // `SHEET_SNAP_FRACTIONS[snap]` of the viewport stays revealed.
  return viewportHeight * sheetTranslateYFraction(snap);
}

/**
 * Resolve a drag-release into the snap state the sheet should animate to.
 *
 * Algorithm:
 *  1. Compute the sheet's current effective Y (px from the top of viewport)
 *     as currentSnap's resting Y plus the net drag delta.
 *  2. If the release velocity exceeds the flick threshold, move one snap
 *     step in the flick's direction from the CURRENT snap (a fast flick
 *     overshoots past the nearest snap, matching native bottom-sheet feel)
 *     — dragging down past peek at flick speed dismisses the sheet entirely.
 *  3. Otherwise resolve to whichever snap's resting Y is nearest the
 *     effective Y (plain nearest-neighbour, no velocity factored in).
 */
export function resolveSheetSnap({
  currentSnap,
  viewportHeight,
  dragDeltaY,
  velocity,
}: ResolveSnapInput): ResolveSnapResult {
  if (viewportHeight <= 0) return { snap: currentSnap, dismissed: false };

  const isFlick = Math.abs(velocity) >= VELOCITY_FLICK_THRESHOLD;

  if (isFlick) {
    const currentIndex = SHEET_SNAP_ORDER.indexOf(currentSnap);
    const draggingDown = velocity > 0;
    if (draggingDown) {
      if (currentIndex <= 0) return { snap: "peek", dismissed: true };
      return { snap: SHEET_SNAP_ORDER[currentIndex - 1], dismissed: false };
    }
    const nextIndex = Math.min(currentIndex + 1, SHEET_SNAP_ORDER.length - 1);
    return { snap: SHEET_SNAP_ORDER[nextIndex], dismissed: false };
  }

  const effectiveY = snapToY(currentSnap, viewportHeight) + dragDeltaY;

  // Dismiss when dragged down well past peek's resting position (more than
  // half of peek's own revealed height further down) without enough velocity
  // to count as a flick — a slow, deliberate drag off the bottom.
  const peekY = snapToY("peek", viewportHeight);
  const dismissThreshold = peekY + viewportHeight * SHEET_SNAP_FRACTIONS.peek * 0.5;
  if (effectiveY > dismissThreshold) {
    return { snap: "peek", dismissed: true };
  }

  let nearest: SheetSnap = "peek";
  let nearestDist = Infinity;
  for (const snap of SHEET_SNAP_ORDER) {
    const dist = Math.abs(snapToY(snap, viewportHeight) - effectiveY);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = snap;
    }
  }
  return { snap: nearest, dismissed: false };
}

/** translateY in px for a given snap + viewport height — used by the sheet's inline style while dragging/settling. */
export function sheetTranslateY(snap: SheetSnap, viewportHeight: number): number {
  return snapToY(snap, viewportHeight);
}

export type ContentFitInput = {
  /** Viewport height in px. */
  viewportHeight: number;
  /** Measured sheet-header height in px. */
  headerHeight: number;
  /** Reserved clearance (tab bar + safe area) below the body, in px. */
  dockClearance: number;
  /** The body's natural content extent (scrollHeight) in px. */
  contentHeight: number;
};

export type ContentFit = {
  /** Body height to pin (equals the natural content height). */
  bodyPx: number;
  /** translateY (px) that anchors content `dockClearance` above the tab bar. */
  translatePx: number;
};

/**
 * Content-fit for the `half` detent (the void-killer, owner's "TfL live"
 * screenshot). When the body's natural content is SHORTER than the height the
 * half snap would give it, hug the content instead of stretching to 55dvh and
 * showing a white void: pin the body to its content height and translate the
 * sheet so the content's bottom sits the same `dockClearance` above the tab bar
 * the full-height half uses.
 *
 * Returns null when content is tall enough to fill (or exceed) half — the
 * caller then uses the normal 55dvh half detent — or when inputs are
 * degenerate. The result never exceeds the half snap on open, and because it
 * only governs the resting half detent, full/peek and the live drag stay
 * authoritative. Pure; exported for tests.
 */
export function resolveHalfContentFit(input: ContentFitInput): ContentFit | null {
  const { viewportHeight, headerHeight, dockClearance, contentHeight } = input;
  if (!(viewportHeight > 0) || !(contentHeight > 0)) return null;
  const halfBodyPx = viewportHeight * SHEET_SNAP_FRACTIONS.half - headerHeight - dockClearance;
  if (!(halfBodyPx > 0) || contentHeight >= halfBodyPx) return null;
  const translatePx = Math.max(0, Math.round(viewportHeight - headerHeight - contentHeight - dockClearance));
  return { bodyPx: contentHeight, translatePx };
}
