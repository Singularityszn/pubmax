import { projectMomentum } from "@/lib/springMotion";

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
export const SHEET_SNAP_ORDER = ["peek", "half", "full"] as const satisfies readonly SheetSnap[];

/**
 * MapLibre easeTo `offset` (px) so a selected pub sits in the visible map band
 * above the mobile bottom sheet — not under it.
 *
 * THE SIGN IS THE WHOLE POINT. MapLibre puts the requested centre at the
 * container centre PLUS this offset, and screen Y grows downward, so a
 * POSITIVE Y pushes the pin DOWN — under the sheet, which is the defect this
 * function existed to prevent (measured on a 390x844 phone: a deep-linked pin
 * projected to y 654 with the sheet's top edge at 316). The target sits above
 * the sheet, so the offset is NEGATIVE.
 *
 * `sheetTopPx` is the sheet's measured top edge in the same viewport. It may
 * only ever move the pin HIGHER than the snap fraction implies, never lower:
 * the venue sheet is content-height and slides in from below the fold, so a
 * reading taken mid-entrance reports an edge near the bottom of the screen, and
 * trusting that one would park the pin exactly where the settled sheet lands.
 * Taking the higher of the two answers means an unmeasurable sheet, a sheet
 * still arriving and a taller-than-half sheet all leave the pin in map the
 * reader can see.
 *
 * Default assumes the sheet opens at `half` (selectVenue always does).
 */
export function mobileSelectCameraOffset(
  viewportHeight: number,
  snap: SheetSnap = "half",
  sheetTopPx?: number | null,
): [number, number] {
  const h = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  if (h <= 0) return [0, 0];
  // Where the uncovered band's midpoint sits, measured down from the top.
  const snapMidPx = ((1 - SHEET_SNAP_FRACTIONS[snap]) / 2) * h;
  const measuredMidPx =
    typeof sheetTopPx === "number" && Number.isFinite(sheetTopPx) && sheetTopPx > 0
      ? Math.min(sheetTopPx, h) / 2
      : null;
  const visibleMidPx =
    measuredMidPx === null ? snapMidPx : Math.min(measuredMidPx, snapMidPx);
  // Carry the pin from the container centre up to that midpoint. Never
  // downward: a sheet taller than the viewport leaves no band, and the centre
  // is still better than under the sheet.
  const y = Math.round(visibleMidPx - h / 2);
  return [0, Math.min(0, y)];
}

/**
 * Resting translateY as a fraction of viewport height (DOWN from a full-
 * viewport-tall sheet at translateY(0)). Derived from SHEET_SNAP_FRACTIONS so
 * CSS (`Nv h`), drag px offsets, and resolveSheetSnap all share one source:
 *   translateFraction = 1 - revealedFraction
 *   → full 0.08, half 0.45, peek 0.86
 */
export type DeepLinkSelectionCameraInput = {
  /** The venue the link named, as the camera last understood it. */
  arrivalVenueId: string;
  /** The venue selected right now. */
  selectedVenueId: string;
  /** Whether this map has already moved for a selection. */
  cameraSpent: boolean;
};

export type DeepLinkSelectionCameraDecision = {
  /** Wait for the sheet's own edge before moving, rather than measuring now. */
  measureSheet: boolean;
  /** The arrival venue id to carry forward. */
  arrivalVenueId: string;
};

/**
 * Whether a selection is still the cold deep-link arrival, and which id that
 * arrival now names.
 *
 * A link that named a venue owes one measured move: the canvas can paint before
 * the sheet portal mounts, so measuring at once takes the fraction fallback and
 * parks the named pin outside the visible band. That stays true when the id is
 * rewritten to its canonical form mid-arrival, which is why the arrival id
 * follows the selection until the camera has actually moved for one.
 *
 * A link that named no venue (a bare `?landmark=` arrival) is not this case:
 * its first ordinary tap lands on a painted map and must move at once.
 */
export function deepLinkSelectionCamera({
  arrivalVenueId,
  selectedVenueId,
  cameraSpent,
}: DeepLinkSelectionCameraInput): DeepLinkSelectionCameraDecision {
  if (cameraSpent || !arrivalVenueId || !selectedVenueId) {
    return { measureSheet: false, arrivalVenueId };
  }
  return { measureSheet: true, arrivalVenueId: selectedVenueId };
}

export const SHEET_SNAP_TRANSLATE_FRACTIONS = {
  peek: 1 - SHEET_SNAP_FRACTIONS.peek,
  half: 1 - SHEET_SNAP_FRACTIONS.half,
  full: 1 - SHEET_SNAP_FRACTIONS.full,
} as const;

export const SHEET_ENTRANCE_OVERSHOOT_DAMPING = 0.75;

/**
 * How long the phone sheet's entrance takes.
 *
 * The entrance is a TRANSFORM, not a height animation: this sheet is
 * bottom-anchored and springing its box height moved everything inside it,
 * which Chrome scores as layout shift (see openAtSnap in
 * components/mobile/useSheetHeightDrag.ts). The number is shared by the CSS
 * that draws the slide (`.sheet-entering` in mobileMapShell.css) and the hook
 * that holds the class on for its duration, so the two cannot drift.
 */
export const SHEET_ENTRANCE_MS = 340;

export const VENUE_REVEAL_STALE_MS = 8_000;
export const VENUE_REVEAL_SHORT_MS = 160;
export const VENUE_REVEAL_CINEMA_MS = 480;
export const VENUE_REVEAL_REDUCED_MOTION_QUERY =
  "(prefers-reduced-motion: reduce)";

export function venueRevealPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.(VENUE_REVEAL_REDUCED_MOTION_QUERY).matches === true
  );
}

export type VenueRevealForm = "full" | "short";

export function revealForm(
  now: number,
  lastRevealAt: number | null,
): VenueRevealForm {
  if (lastRevealAt === null || !Number.isFinite(lastRevealAt)) return "full";
  if (now - lastRevealAt >= VENUE_REVEAL_STALE_MS) return "full";
  return "short";
}

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
 *  2. If release velocity exceeds the flick threshold, project its natural
 *     deceleration endpoint. Strong intent can cross more than one detent.
 *  3. Resolve to whichever snap's resting Y is nearest the effective or
 *     projected Y.
 */
export function resolveSheetSnap({
  currentSnap,
  viewportHeight,
  dragDeltaY,
  velocity,
}: ResolveSnapInput): ResolveSnapResult {
  if (viewportHeight <= 0) return { snap: currentSnap, dismissed: false };

  const isFlick = Math.abs(velocity) >= VELOCITY_FLICK_THRESHOLD;

  const effectiveY = snapToY(currentSnap, viewportHeight) + dragDeltaY;
  const releaseY = isFlick
    ? projectMomentum(effectiveY, velocity)
    : effectiveY;

  // Dismiss when dragged down well past peek's resting position (more than
  // half of peek's own revealed height further down). Momentum may dismiss
  // only when the gesture started at peek; a flick from a higher detent first
  // lands at peek instead of skipping the final recovery point.
  const peekY = snapToY("peek", viewportHeight);
  const dismissThreshold = peekY + viewportHeight * SHEET_SNAP_FRACTIONS.peek * 0.5;
  if (
    effectiveY > dismissThreshold ||
    (currentSnap === "peek" && releaseY > dismissThreshold)
  ) {
    return { snap: "peek", dismissed: true };
  }

  let nearest: SheetSnap = "peek";
  let nearestDist = Infinity;
  for (const snap of SHEET_SNAP_ORDER) {
    const dist = Math.abs(snapToY(snap, viewportHeight) - releaseY);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = snap;
    }
  }
  return { snap: nearest, dismissed: false };
}

/** translateY in px for a given snap + viewport height — used by the LEGACY
 *  641–768px inline drawer's drag (components/map/useSheetDrag.ts) and PubMap's
 *  inline drawer transforms. The rebuilt phone portal sheet no longer uses a
 *  translateY snap model — see the height resolver below. */
export function sheetTranslateY(snap: SheetSnap, viewportHeight: number): number {
  return snapToY(snap, viewportHeight);
}

export function sheetClosedTranslateY(
  viewportHeight: number,
  bottomClearance: number,
): number {
  const height =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const clearance =
    Number.isFinite(bottomClearance) && bottomClearance > 0
      ? bottomClearance
      : 0;
  return height + clearance;
}

// ── Height-driven snap resolver (bottom-anchored content-fit sheet model) ─────
// The rebuilt mobile portal sheet (components/mobile/MobileSharedSheet.tsx) is a
// bottom-anchored flex column whose rendered height is min(content, cap) — CSS
// `height:auto; max-height:<cap>` does the void-killing natively, so there is no
// content-measuring, no reserved-footer var math, no translateY. A drag grows or
// shrinks that height directly, so a release resolves by comparing the released
// HEIGHT to each snap's cap — the height-space mirror of resolveSheetSnap's
// translateY nearest-neighbour.

export type SheetSnapCaps = Record<SheetSnap, number>;

/**
 * Per-snap cap heights (px) for the bottom-anchored sheet: the snap's fraction
 * of the viewport MINUS `dockPx`, the sheet box's bottom offset from the viewport
 * bottom (the rebuilt phone sheet anchors at bottom:0, so the hook passes 0 and
 * the caps are the plain `<fraction>dvh` used in mobileMapShell.css; the param
 * keeps the resolver correct if the anchor ever grows a safe-area/dock offset).
 */
export function sheetSnapCaps(viewportHeight: number, dockPx: number): SheetSnapCaps {
  const cap = (snap: SheetSnap) =>
    Math.max(0, viewportHeight * SHEET_SNAP_FRACTIONS[snap] - dockPx);
  return { peek: cap("peek"), half: cap("half"), full: cap("full") };
}

export type ResolveHeightSnapInput = {
  /** Snap the drag started from. */
  startSnap: SheetSnap;
  /**
   * Rendered box height (px) at grab — the START snap's true resting height
   * (content-hugged when short, cap when tall). Used as the START snap's
   * reference so a short content-hugged half stays half instead of mis-snapping
   * to peek merely because its px height sits in peek's band.
   */
  startHeightPx: number;
  /** Presented box height (px) at release. */
  releaseHeightPx: number;
  /**
   * Signed height velocity (px/ms) at release: + = growing (dragged up), − =
   * shrinking (dragged down). 0 for a still/paused release.
   */
  velocity: number;
  /** Per-snap cap heights (px), from sheetSnapCaps. */
  caps: SheetSnapCaps;
};

/**
 * Resolve a height-drag release to a snap. Mirrors resolveSheetSnap:
 *  • A flick (|velocity| ≥ threshold) projects a deceleration endpoint, so
 *    strong intent may cross more than one detent.
 *  • Otherwise nearest-neighbour on the released height, where the START snap's
 *    reference is its rendered start height and every other snap uses its cap.
 *  • A slow collapse below half of peek's cap dismisses.
 * Pure; exported for tests.
 */
export function resolveSheetHeightSnap({
  startSnap,
  startHeightPx,
  releaseHeightPx,
  velocity,
  caps,
}: ResolveHeightSnapInput): ResolveSnapResult {
  const isFlick = Math.abs(velocity) >= VELOCITY_FLICK_THRESHOLD;
  const projectedHeight = isFlick
    ? projectMomentum(releaseHeightPx, velocity)
    : releaseHeightPx;

  // A physical collapse well below peek dismisses. Projected momentum may
  // dismiss only from peek so a flick from half still has a recoverable stop.
  const dismissThreshold = caps.peek * 0.5;
  if (
    releaseHeightPx < dismissThreshold ||
    (startSnap === "peek" && projectedHeight < dismissThreshold)
  ) {
    return { snap: "peek", dismissed: true };
  }

  const ref = (snap: SheetSnap) => (snap === startSnap ? startHeightPx : caps[snap]);
  let nearest: SheetSnap = SHEET_SNAP_ORDER[0];
  let nearestDist = Infinity;
  for (const snap of SHEET_SNAP_ORDER) {
    const dist = Math.abs(ref(snap) - projectedHeight);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = snap;
    }
  }
  return { snap: nearest, dismissed: false };
}
