import Link from "next/link";

import "./nowSegment.css";

type NowBeat = "day" | "tonight";

/**
 * Day | Tonight switch at the head of /today and /tonight. Links, not local
 * state: the URL is the truth and nothing is remembered.
 */
export default function NowSegment({ current }: { current: NowBeat }) {
  return (
    <div className="nowSegment" role="radiogroup" aria-label="Now">
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
