"use client";

import { useEffect, useState } from "react";

import { loadPriceHistory } from "@/lib/priceHistoryLoader";
import {
  formatObservedDay,
  formatObservedMonth,
  venuePriceArc,
  type PriceComparisonItem,
  type PriceHistoryObservation,
} from "@/lib/priceHistory";
import { PRICE_NOT_COMPARED_LINE, priceMovementLine } from "@/lib/priceMovementLine";
import { formatPrice } from "@/lib/venues";

import "./venuePriceThen.css";

// What a pint here used to cost.
//
// One dated, sourced figure from the archives against the price on record
// today. "£3.60 in July 2013. £6.50 now." is the whole thing; everything else
// on this block exists to let a reader check that sentence, which is why the
// source is named, dated and linked rather than summarised.
//
// A movement ("Down £0.46 in 13 years.") is a third claim and prints only when
// both figures state the same pint at an ordinary price (lib/priceHistory.ts,
// `sameComparisonItem`). Otherwise both figures stand and one line says why
// there is no movement.
//
// The historical figure is a fact about the past and nothing else. It reaches
// this component and stops: it never touches price bands, pin colour, the
// cheapest-pint buckets or the Pint Index. See the hard rule at the top of
// lib/priceHistory.ts, pinned by __tests__/priceHistory.test.ts.

// The loaded rows, tagged with the venue they were loaded for. Tagging (rather
// than clearing state when the venue changes) keeps the effect free of a
// synchronous setState, so switching pubs never cascades a render, and a stale
// answer for the previous pub can never be shown as this one's history.
type Loaded = { venueId: string; rows: PriceHistoryObservation[] };

function useVenueHistory(venueId: string): PriceHistoryObservation[] | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPriceHistory()
      .then((byVenue) => {
        if (!cancelled) setLoaded({ venueId, rows: byVenue.get(venueId) ?? [] });
      })
      .catch(() => {
        // Fail soft: no history block, sheet renders exactly as before.
        if (!cancelled) setLoaded({ venueId, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [venueId]);
  return loaded && loaded.venueId === venueId ? loaded.rows : null;
}

export default function VenuePriceThen({
  venueId,
  currentPriceGbp,
  currentItem = null,
}: {
  venueId: string;
  /** Whatever the sheet is already showing as this pub's price today, or null. */
  currentPriceGbp: number | null | undefined;
  /** What today's figure is a price FOR, where its source states all of it. */
  currentItem?: PriceComparisonItem | null;
}) {
  const history = useVenueHistory(venueId);
  const arc = history ? venuePriceArc(history, currentPriceGbp, undefined, currentItem) : null;
  if (!arc) return null;

  const { then, nowGbp, deltaGbp, years } = arc;
  return (
    <section className="venuePriceThen" aria-labelledby={`vptTitle-${venueId}`}>
      <h4 className="vptTitle" id={`vptTitle-${venueId}`}>
        What it used to cost
      </h4>
      {/* Two sentences, each unbreakable, so a narrow sheet breaks BETWEEN them
          and never orphans "now." on a line of its own. */}
      <p className="vptLine">
        <span className="vptClause">
          <strong className="vptThen">{formatPrice(then.priceGbp)}</strong> in{" "}
          {formatObservedMonth(then.observedOn)}.
        </span>
        {nowGbp !== null ? (
          <>
            {" "}
            <span className="vptClause">
              <strong className="vptNow">{formatPrice(nowGbp)}</strong> now.
            </span>
          </>
        ) : null}
      </p>
      {deltaGbp !== null ? (
        <p className="vptMovement">{priceMovementLine(deltaGbp, years)}</p>
      ) : null}
      <p className="vptSource">
        <a href={then.source.url} target="_blank" rel="noopener noreferrer">
          {then.source.label}
        </a>
        , {formatObservedDay(then.observedOn)}
      </p>
      {nowGbp !== null ? (
        <p className="vptNote">
          {deltaGbp !== null
            ? "A pint someone paid for then, against the price this pub has on record now."
            : PRICE_NOT_COMPARED_LINE}
        </p>
      ) : null}
    </section>
  );
}
