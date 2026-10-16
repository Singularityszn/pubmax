// When the floating compose control steps aside for the page under it.
//
// The control floats over every scrolling phone page, and the lane it reserves
// (`.createFabLane`, components/nav/createFab.css) only reaches the rows that
// opt in: a price column, a way-onward arrow. Running prose cannot give up
// 80px of a 390px line, so on /about, a venue story or a FAQ answer the + sat
// on the words a reader was in the middle of. A reader scrolling DOWN is
// reading, so the control tucks away; scrolling UP is looking for something,
// and the end of the page is where the body already reserves the control's own
// band, so either brings it back.
//
// The rule is pure so it can be pinned without a browser; the listener that
// feeds it is `useCreateFabScrollTuck` below.

import { useEffect, useState } from "react";

/** Scroll travel, in CSS pixels, that counts as a direction rather than jitter. */
export const CREATE_FAB_SCROLL_TUCK_THRESHOLD = 8;

/**
 * Above this offset the page has not been read past its first screen of
 * content yet, so the control stays put: a reader who has not moved has
 * nothing to step aside for.
 */
export const CREATE_FAB_SCROLL_TUCK_MIN_OFFSET = 96;

export type CreateFabScrollReading = {
  /** window.scrollY now. */
  y: number;
  /** The offset the last decision was taken at. */
  anchorY: number;
  /** The largest offset the page can scroll to. */
  maxY: number;
};

/**
 * Whether the control is tucked after this reading. `undefined` means the
 * travel since the anchor is still jitter: keep the current state and keep
 * the anchor where it is.
 */
export function nextCreateFabScrollTucked(
  reading: CreateFabScrollReading,
): boolean | undefined {
  const { y, anchorY, maxY } = reading;
  if (y <= CREATE_FAB_SCROLL_TUCK_MIN_OFFSET) return false;
  // The foot of the page sits in the band the body reserves for the control,
  // so nothing is under it there; a momentum bounce past the end still counts.
  if (y >= maxY - CREATE_FAB_SCROLL_TUCK_THRESHOLD) return false;
  const travel = y - anchorY;
  if (Math.abs(travel) < CREATE_FAB_SCROLL_TUCK_THRESHOLD) return undefined;
  return travel > 0;
}

/**
 * The live reading of `nextCreateFabScrollTucked`, one decision per frame.
 * `enabled` false parks it untucked: an open create sheet must never slide out
 * from under the reader's thumb.
 */
export function useCreateFabScrollTuck(enabled: boolean): boolean {
  const [tucked, setTucked] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let anchorY = window.scrollY;
    let frame = 0;
    const decide = () => {
      frame = 0;
      const y = window.scrollY;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      const next = nextCreateFabScrollTucked({ y, anchorY, maxY });
      if (next === undefined) return;
      anchorY = y;
      setTucked(next);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(decide);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
      setTucked(false);
    };
  }, [enabled]);

  return enabled && tucked;
}
