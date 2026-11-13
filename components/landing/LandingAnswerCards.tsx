import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { trackEvent } from "@/lib/analytics";
import type { LandingAnswers } from "@/lib/landingAnswers";
import LondonDayStamp from "./LondonDayStamp";

// What is on today, and what is on tonight, in one sentence each.
//
// Captain 7 Sep 2026: "Let's say: What is happening today? What is happening
// tonight?" Both sentences are built server-side by lib/landingAnswers.server.ts
// from the very lanes /today and /tonight read, and each card carries the London
// day it speaks for, so a reader can tell a fresh answer from a held one. A lane
// that could not be read prints its own honest line and no number.
//
// Under the two answers sits the one door to Pub Pal. The site review (18 Oct
// 2026) found the feature the product calls its difference reachable only from
// the footer and a desktop-only menu. It is a door, not an answer, so it
// carries no figure and no day, and it spans the grid rather than sitting
// beside a sentence about tonight.

export default function LandingAnswerCards({
  answers,
  dutyCensus = null,
}: {
  answers: LandingAnswers;
  /** The duty census card, under Tonight and spanning the grid. */
  dutyCensus?: ReactNode;
}) {
  return (
    <section className="lpAnswers" aria-labelledby="lp-answers-title">
      <h2 className="lpAnswersTitle" id="lp-answers-title">
        Today and tonight
      </h2>

      <div className="lpAnswersGrid">
        <Link prefetch={false} href="/today" className="lpAnswerTile">
          <span className="lpAnswerTileHead">
            What&rsquo;s on today
            <ChevronRight size={16} aria-hidden="true" className="lpAnswerTileChevron" />
          </span>
          <span className="lpAnswerTileLine">{answers.today.line}</span>
          <LondonDayStamp stamp={answers.today.stamp} />
        </Link>
        <Link prefetch={false} href="/tonight" className="lpAnswerTile">
          <span className="lpAnswerTileHead">
            What&rsquo;s on tonight
            <ChevronRight size={16} aria-hidden="true" className="lpAnswerTileChevron" />
          </span>
          <span className="lpAnswerTileLine">{answers.tonight.line}</span>
          <LondonDayStamp stamp={answers.tonight.stamp} />
        </Link>
        {dutyCensus}
        <Link
          prefetch={false}
          href="/pal"
          className="lpAnswerTile lpAnswerTileWide"
          onClick={() => trackEvent("landing_cta_clicked", { target: "pal" })}
        >
          <span className="lpAnswerTileHead">
            Plan it with your Pub Pal
            <ChevronRight size={16} aria-hidden="true" className="lpAnswerTileChevron" />
          </span>
          <span className="lpAnswerTileLine">
            Plan a route using listed prices from the map. It remembers only what you approve.
          </span>
        </Link>
      </div>
    </section>
  );
}
