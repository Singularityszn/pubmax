"use client";

import Link from "next/link";

import { handleRovingRadioKeyDown } from "@/lib/rovingRadioGroup";

import "./nowSegment.css";

type NowBeat = "day" | "tonight";

/**
 * Day | Tonight switch at the head of /today and /tonight. Links, not local
 * state: the URL is the truth and nothing is remembered.
 *
 * Roving focus is the other half of the radiogroup contract - the unselected
 * option is out of the tab order, so the arrow keys are its only way in.
 */
export default function NowSegment({ current }: { current: NowBeat }) {
  return (
    <div
      className="nowSegment"
      role="radiogroup"
      aria-label="Now"
      onKeyDown={handleRovingRadioKeyDown}
    >
      <Link
        href="/today"
        role="radio"
        className="nowSegmentOpt"
        aria-checked={current === "day"}
        tabIndex={current === "day" ? 0 : -1}
      >
        Day
      </Link>
      <Link
        href="/tonight"
        role="radio"
        className="nowSegmentOpt"
        aria-checked={current === "tonight"}
        tabIndex={current === "tonight" ? 0 : -1}
      >
        Tonight
      </Link>
    </div>
  );
}
