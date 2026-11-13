import type { Route } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import {
  DUTY_CENSUS,
  DUTY_CENSUS_DAYS,
  DUTY_CENSUS_LINE,
  type DutyCensusView,
} from "@/lib/dutyCensus";
import "./dutyCensus.css";

// The before-1-February census line. The home holds it under Tonight; the
// venue sheet shows it once a priced Pint Drop lands. It is drawn on the
// server and on the client alike, so it holds no state of its own.

export default function DutyCensusCard({
  view,
  logHref = null,
  className = "",
}: {
  view: DutyCensusView;
  /** Where "Log a price" goes. Null after a log, because the reader just did. */
  logHref?: Route | null;
  className?: string;
}) {
  const { count, countedAt, elapsed } = view;
  return (
    <section className={`dutyCensus ${className}`.trim()} aria-label="Pint price census">
      <div className="dutyCensusSay">
        <p className="dutyCensusKicker">Pint price census</p>
        <p className="dutyCensusLine">{DUTY_CENSUS_LINE}</p>
        <p className="dutyCensusWhy">What you log now goes on the record as the before.</p>
      </div>

      <div className="dutyCensusTally">
        <div
          className="dutyCensusRail"
          aria-hidden="true"
          style={{ "--census-elapsed": elapsed } as CSSProperties}
        >
          <span className="dutyCensusRailDate">{DUTY_CENSUS_DAYS.startShort}</span>
          <span className="dutyCensusRailTrack">
            <span className="dutyCensusRailFill" />
            <span className="dutyCensusRailNow" />
          </span>
          <span className="dutyCensusRailDate">{DUTY_CENSUS_DAYS.riseShort}</span>
          <span className="dutyCensusRailRise">+{DUTY_CENSUS.dutyRisePercent}%</span>
        </div>

        {count !== null ? (
          <p className="dutyCensusCount">
            <span className="dutyCensusFigure">{count.toLocaleString("en-GB")}</span> prices logged in
            public since {DUTY_CENSUS_DAYS.startLong}.
            {countedAt ? <span className="dutyCensusStamp">Counted {countedAt}</span> : null}
          </p>
        ) : null}

        <p className="dutyCensusLinks">
          {logHref ? (
            <Link prefetch={false} href={logHref} className="dutyCensusLink">
              Log a price
            </Link>
          ) : null}
          <a
            href={DUTY_CENSUS.source.url}
            rel="noreferrer"
            title={DUTY_CENSUS.source.title}
            className="dutyCensusLink dutyCensusSource"
          >
            <span>
              Source: {DUTY_CENSUS.source.label},{" "}
              <span className="dutyCensusSourceDate">{DUTY_CENSUS_DAYS.sourceShort}</span>
            </span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </p>
      </div>
    </section>
  );
}
