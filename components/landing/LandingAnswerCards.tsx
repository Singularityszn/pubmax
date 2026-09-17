import Link from "next/link";

import type { LandingAnswers } from "@/lib/landingAnswers";

// What is on today, and what is on tonight, in one sentence each.
//
// Captain 7 Sep 2026: "Let's say: What is happening today? What is happening
// tonight?" Both sentences are built server-side by lib/landingAnswers.server.ts
// from the very lanes /today and /tonight read, and each card carries the London
// day it speaks for, so a reader can tell a fresh answer from a held one. A lane
// that could not be read prints its own honest line and no number.

export default function LandingAnswerCards({ answers }: { answers: LandingAnswers }) {
  return (
    <section className="lpAnswers" aria-labelledby="lp-answers-title">
      <h2 className="lpAnswersTitle" id="lp-answers-title">
        Before you set off
      </h2>
      <div className="lpAnswersGrid">
        <Link prefetch={false} href="/today" className="lpAnswerTile">
          <span className="lpAnswerTileHead">What&rsquo;s on today</span>
          <span className="lpAnswerTileLine">{answers.today.line}</span>
          <span className="lpAnswerTileStamp">{answers.today.stamp}</span>
        </Link>
        <Link prefetch={false} href="/tonight" className="lpAnswerTile">
          <span className="lpAnswerTileHead">What&rsquo;s on tonight</span>
          <span className="lpAnswerTileLine">{answers.tonight.line}</span>
          <span className="lpAnswerTileStamp">{answers.tonight.stamp}</span>
        </Link>
      </div>
    </section>
  );
}
