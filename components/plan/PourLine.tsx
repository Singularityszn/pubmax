"use client";

import { useEffect, useState } from "react";

import "./pourLine.css";

/** How long the landed line takes to pour all the way round, then fade. */
const LANDING_MS = 420;

/**
 * A short line of ink that runs round the edge of a busy control, the way a
 * pint fills while you wait at the bar. When the work lands, the line pours
 * the whole way round once and goes, so the end of the wait is felt as well
 * as read.
 *
 * Bookmarked on 21st.dev as Border Beam Search, rebuilt inside the house rules:
 * one solid ink stroke on an SVG outline, with no gradient, no glow, no hue
 * cycling and no coral, and it moves only while the control is busy. The
 * control's own words ("Planning…") and its status region still say what is
 * happening; this is the feeling of it, so it is hidden from assistive tech.
 * Reduced motion keeps a still outline and drops the run and the pour.
 *
 * The parent must be `position: relative`; the outline follows its box and a
 * corner of `--radius`.
 */
export default function PourLine({ busy }: { busy: boolean }) {
  const [wasBusy, setWasBusy] = useState(busy);
  const [landing, setLanding] = useState(false);
  // Decided in the render that ends the wait, so the same outline element
  // turns from running to pouring and its CSS transition has a start to run
  // from (React's "adjust state when a prop changes" pattern).
  if (busy !== wasBusy) {
    setWasBusy(busy);
    setLanding(wasBusy && !busy);
  }

  useEffect(() => {
    if (!landing) return;
    const end = window.setTimeout(() => setLanding(false), LANDING_MS);
    return () => window.clearTimeout(end);
  }, [landing]);

  if (!busy && !landing) return null;
  return (
    <svg
      className={busy ? "pourLine" : "pourLine isLanding"}
      aria-hidden="true"
      focusable="false"
      data-pour-line={busy ? "busy" : "landing"}
    >
      {/* rx mirrors --radius (8px), the corner of the controls it rides. */}
      <rect width="100%" height="100%" rx="8" ry="8" pathLength="100" />
    </svg>
  );
}
