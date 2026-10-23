/**
 * The `behavior` for a scripted scroll. A smooth scroll is travel, so it sits
 * behind the reduced-motion contract (docs/DESIGN_SYSTEM.md, Motion): a reader
 * who asked for less motion is jumped straight to the target.
 */
export function scrollMotionBehavior(): ScrollBehavior {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  return reduced ? "auto" : "smooth";
}
