/**
 * Shared motion physics for the landing/cinema/splash surfaces (PIECE 1 of
 * feat(landing): hero scroll cinema with aperture splash).
 *
 * This is the single place `prefers-reduced-motion` is read for those
 * surfaces. No component under components/landing or the splash script
 * should call `matchMedia("(prefers-reduced-motion: reduce)")` on its own -
 * import prefersReducedMotion()/onReducedMotionChange() from here instead, so
 * a future change to the check (e.g. also honouring Legacy Mode) only needs
 * one edit.
 *
 * app/globals.css already owns --duration- and --ease- tokens for short
 * (<=280ms) UI feedback (button presses, dropdowns, toasts). Those are too
 * short for a full-viewport scroll-scrubbed sequence or a sub-second splash,
 * so this module adds its own constants sized for those two cases. A
 * follow-up task migrates the rest of the app onto this module; this PR only
 * wires the landing/cinema/splash surfaces it touches.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Subscribe to prefers-reduced-motion changes. Returns an unsubscribe fn. */
export function onReducedMotionChange(
  callback: (reduced: boolean) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  const handler = () => callback(mql.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

/** Durations in ms. */
export const motionDuration = {
  /** Aperture splash hard ceiling - the whole splash must resolve by here. */
  splashCeiling: 700,
  /** Aperture splash hold before the coral X starts opening. */
  splashHold: 180,
  /** Settle time for a non-scroll-linked micro-transition inside the cinema
   *  (e.g. hero pins fading in once the card has settled). Not used by the
   *  scroll-scrubbed transform itself, which is driven by scroll position,
   *  not a duration. */
  cinemaSettle: 480,
} as const;

/**
 * Easing curves. `weighted` is the cinema house curve: damped, physical,
 * settles without overshoot or snap - used as the animation-timing-function
 * on the scroll-scrubbed keyframes (see components/landing/heroCinema.css)
 * so the transform's response to scroll position feels weighted even though
 * a scrubbed animation has no duration of its own.
 */
export const motionEase = {
  weighted: "cubic-bezier(0.22, 1, 0.36, 1)",
  splashAperture: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
