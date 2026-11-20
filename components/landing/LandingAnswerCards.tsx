import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { trackEvent } from "@/lib/analytics";
import type { LandingAnswers } from "@/lib/landingAnswers";

const LandingTonightAnswer = lazy(() => import("./LandingTonightAnswer"));

// What is on today, and what is on tonight, in one sentence each.
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
  const tonightTile = useRef<HTMLAnchorElement>(null);
  const [readTonight, setReadTonight] = useState(false);
  useEffect(() => {
    if (readTonight || !tonightTile.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setReadTonight(true);
    });
    observer.observe(tonightTile.current);
    return () => observer.disconnect();
  }, [readTonight]);
  const heldTonight = (
    <>
      <span className="lpAnswerTileLine">{answers.tonight.line}</span>
      {answers.tonight.stamp ? <span className="lpAnswerTileStamp">{answers.tonight.stamp}</span> : null}
    </>
  );

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
          <span className="lpAnswerTileStamp">{answers.today.stamp}</span>
        </Link>
        <Link prefetch={false} href="/tonight" className="lpAnswerTile" ref={tonightTile}
          onFocus={() => setReadTonight(true)} onPointerEnter={() => setReadTonight(true)}>
          <span className="lpAnswerTileHead">
            What&rsquo;s on tonight
            <ChevronRight size={16} aria-hidden="true" className="lpAnswerTileChevron" />
          </span>
          {readTonight ? (
            <Suspense fallback={heldTonight}>
              <LandingTonightAnswer hypedCount={answers.hypedCount} />
            </Suspense>
          ) : heldTonight}
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
