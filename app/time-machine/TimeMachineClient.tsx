"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState, type ChangeEvent } from "react";

import ShareBar from "@/components/share/ShareBar";
import {
  formatTimeMachinePrice,
  ONLY_DATED_LINE,
  pubCountLabel,
  rowsForYear,
  timeMachinePath,
  timeMachineShareText,
  type TimeMachineData,
} from "@/lib/priceTimeMachine";
import { venueMapUrl } from "@/lib/venueMapUrl";

// The engine is the heaviest thing on the page, so it loads after the list
// and the slider have painted. The list under the map is the page's answer,
// and it reads the same with no map at all.
const TimeMachineMapCanvas = dynamic(() => import("./TimeMachineMapCanvas"), {
  ssr: false,
  loading: () => <div className="tmMapCanvas" aria-hidden="true" />,
});

export default function TimeMachineClient({
  data,
  initialYear,
}: {
  data: TimeMachineData;
  initialYear: number;
}) {
  const [year, setYear] = useState(initialYear);
  const [mapFailed, setMapFailed] = useState(false);
  const rows = rowsForYear(data, year);
  const count = rows.length;

  // venueId to the price its pin prints this year. A pub absent here is grey.
  const lit = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of rowsForYear(data, year)) {
      if (row.placed) out[row.venueId] = formatTimeMachinePrice(row.priceGbp);
    }
    return out;
  }, [data, year]);

  const onYear = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isInteger(next)) return;
    setYear(next);
    // Replace, never push: dragging across ten years is one place in the
    // back history, and the address always names the year on screen.
    try {
      window.history.replaceState(window.history.state, "", timeMachinePath(next));
    } catch {
      // A browser that refuses the write still shows the year; only the link lags.
    }
  }, []);

  const onUnavailable = useCallback(() => setMapFailed(true), []);
  const countLine =
    count === 0
      ? `No pub has a dated record from ${year}.`
      : `${pubCountLabel(count)} with a dated record in ${year}.`;

  return (
    <div className="tmBody">
      <div className="tmControls">
        <label className="tmYearLabel" htmlFor="tmYear">
          Year <output htmlFor="tmYear" className="tmYearValue">{year}</output>
        </label>
        <input
          id="tmYear"
          className="tmYearSlider"
          type="range"
          min={data.minYear}
          max={data.maxYear}
          step={1}
          value={year}
          onChange={onYear}
          aria-valuetext={`${year}, ${pubCountLabel(count)} lit`}
        />
        <div className="tmYearBounds" aria-hidden="true">
          <span>{data.minYear}</span>
          <span>{data.maxYear}</span>
        </div>
      </div>

      <p className="tmOnlyDated">{ONLY_DATED_LINE}</p>
      <p className="tmCount" role="status" aria-live="polite">
        {countLine}
      </p>

      <div className="tmMap">
        {mapFailed ? (
          <p className="tmMapFallback">The map could not load here. The list below holds every lit pub.</p>
        ) : (
          <TimeMachineMapCanvas venues={data.venues} lit={lit} onUnavailable={onUnavailable} />
        )}
      </div>

      <section className="tmListSection" aria-labelledby="tmListHeading">
        <h2 id="tmListHeading" className="listingSectionTitle">
          Pints in {year}
        </h2>
        {count === 0 ? (
          <p className="tmEmpty">
            Nobody left a dated price in a review we hold for {year}. Move the slider to another year.
          </p>
        ) : (
          <ul className="tmList">
            {rows.map((row) => (
              <li key={row.venueId} className="tmRow">
                {row.placed ? (
                  <Link className="tmRowName" prefetch={false} href={venueMapUrl(row.venueId)}>
                    {row.name}
                  </Link>
                ) : (
                  <span className="tmRowName">{row.name}</span>
                )}
                <span className="tmRowPrice">{formatTimeMachinePrice(row.priceGbp)}</span>
                <span className="tmRowWhen">
                  {row.monthLabel},{" "}
                  <a href={row.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                    {row.sourceLabel}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="tmShare">
        <ShareBar
          url={timeMachinePath(year)}
          title={timeMachineShareText(year, count)}
          text={timeMachineShareText(year, count)}
        />
      </div>
    </div>
  );
}
