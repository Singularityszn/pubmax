"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStaggeredRead } from "@/lib/useStaggeredRead";

import { discardBody } from "@/lib/responseBody";
import {
  BEST_VALUE_ROUND_LABEL,
  SPOONS_VALUE_NOT_OUR_FIGURE_LINE,
  SPOONS_VALUE_ROUTE,
  bestValueRoundLine,
  formatUnitsLabel,
  parseSpoonsValueHeld,
  spoonsValueBand,
  spoonsValueBandClass,
  spoonsValueBandLabel,
  spoonsValueCreditLine,
  type SpoonsValueHeld,
} from "@/lib/spoonsValue";

import "./venueSpoonsValueRow.css";

/**
 * What a tenner buys at this pub, on the pub's own sheet.
 *
 * ONE ROUTE FOR BOTH SHEETS. A curated Wetherspoon opens the venue Overview and
 * a national base pub opens the unverified sheet, and 676 of the 788 pubs this
 * lane joins are base pins, so the row is mounted on both and asks the same
 * small, edge-cacheable answer.
 *
 * TWO things it will not do. It never prints a bare figure: the round and what
 * it costs ride with the units, so nothing here can be misread as the price of
 * a pint. And it never claims the number: the figure is SpoonMe's reading of a
 * Wetherspoon menu, credited and linked on the row that prints it.
 */
export default function VenueSpoonsValueRow({
  venueId,
  visible,
}: {
  venueId: string;
  /**
   * The resting pint view. A drink lens or an experience view has taken the
   * sheet somewhere else, and a round of ciders does not answer "where is the
   * coffee". The row owns this rather than its caller so a venue sheet does
   * not grow another branch for it.
   */
  visible: boolean;
}) {
  const [held, setHeld] = useState<SpoonsValueHeld | null>(null);
  // Which pub the held answer is ABOUT. Adopted DURING RENDER rather than in an
  // effect, so this row can never paint one pub's round under another's name.
  const [heldFor, setHeldFor] = useState(venueId);
  if (heldFor !== venueId) {
    setHeldFor(venueId);
    setHeld(null);
  }

  const ready = useStaggeredRead(2, venueId);

  useEffect(() => {
    // Nothing on screen asks the question, so nothing asks the server either.
    if (!visible || !ready) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/spoons-value?venueId=${encodeURIComponent(venueId)}`,
          { signal: controller.signal, headers: { accept: "application/json" } },
        );
        if (!res.ok) {
          discardBody(res);
          return;
        }
        const body = (await res.json()) as { spoonsValue?: unknown };
        const parsed = parseSpoonsValueHeld(body.spoonsValue);
        if (!controller.signal.aborted && parsed) setHeld(parsed);
      } catch {
        // Fail-soft: a pub this row cannot answer for renders nothing, exactly
        // as a pub outside the ranking does. Most pubs are not Wetherspoons, so
        // an absence here is the ordinary case and never a sentence.
      }
    })();
    return () => controller.abort();
  }, [ready, venueId, visible]);

  if (!visible || !held) return null;

  const band = spoonsValueBand(held.row.milliunits, held.modalMilliunits);
  return (
    <section className="venueSpoonsValue" aria-label={BEST_VALUE_ROUND_LABEL}>
      <div className="venueSpoonsValueHead">
        <h4 className="venueSpoonsValueTitle">{BEST_VALUE_ROUND_LABEL}</h4>
        <span className={`venueSpoonsValueUnits ${spoonsValueBandClass(band)}`}>
          {formatUnitsLabel(held.row.milliunits)}
        </span>
      </div>
      <p className="venueSpoonsValueLine">{bestValueRoundLine(held.row)}</p>
      <p className="venueSpoonsValueMeta">
        <span className="venueSpoonsValueStanding">Listed</span>
        {band ? <span className="venueSpoonsValueBand">{spoonsValueBandLabel(band)}</span> : null}
        <span>{`Ranked ${held.row.rankNumber} of ${held.rankedCount}`}</span>
      </p>
      <p className="venueSpoonsValueCredit">
        {`${SPOONS_VALUE_NOT_OUR_FIGURE_LINE} `}
        <a href={held.credit.sourceUrl} rel="noopener noreferrer" target="_blank">
          {spoonsValueCreditLine(held.credit)}
        </a>
        {". "}
        <Link href={SPOONS_VALUE_ROUTE}>See the whole ranking</Link>
      </p>
    </section>
  );
}
