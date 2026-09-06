"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  applySpoonsValueCut,
  formatBasketCost,
  formatUnitsLabel,
  spoonsValueBand,
  spoonsValueBandClass,
  spoonsValueMapHref,
  type SpoonsValueCut,
  type SpoonsValueCutId,
  type SpoonsValueTableRow,
} from "@/lib/spoonsValue";

/**
 * The ranking itself.
 *
 * A CUT NARROWS, IT NEVER RE-RANKS. Every row keeps the rank it holds in the
 * whole country, so a reader who filters to Wales sees where those pubs sit
 * nationally rather than a fresh 1 to 47 that means something else.
 *
 * The table scrolls inside its own box on a phone rather than the page
 * scrolling sideways, and every pub the map could place is a link into it.
 */
export default function SpoonsValueTable({
  rows,
  cuts,
  modalMilliunits,
}: {
  rows: readonly SpoonsValueTableRow[];
  cuts: readonly SpoonsValueCut[];
  modalMilliunits: number | null;
}) {
  const [cut, setCut] = useState<SpoonsValueCutId>("all");
  const shown = useMemo(() => applySpoonsValueCut(rows, cut), [rows, cut]);

  return (
    <>
      <div className="spoonsTableCuts" role="group" aria-label="Narrow the ranking">
        {cuts.map((option) => {
          const selected = option.id === cut;
          return (
            <button
              key={option.id}
              type="button"
              className={selected ? "spoonsTableCut isSelected" : "spoonsTableCut"}
              aria-pressed={selected}
              onClick={() => setCut(option.id)}
            >
              {option.label}
              <span className="spoonsTableCutCount">{option.count}</span>
            </button>
          );
        })}
      </div>

      <div className="spoonsTableScroll">
        <table className="spoonsTable">
          <caption className="spoonsTableCaption">
            {`${shown.length} of ${rows.length} pubs. Rank is national, so it does not change when you narrow the list.`}
          </caption>
          <thead>
            {/* THREE COLUMNS AT EVERY WIDTH. A fourth for the round did not fit
                a 390px screen: it clipped to one word a line and pushed the
                answer behind a sideways scroll. The round belongs with the pub
                it is poured in, so it sits in that cell and the table reads the
                same on a phone and a desktop, wider. */}
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Pub and the round</th>
              <th scope="col">Units for £10</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const href = spoonsValueMapHref(row);
              const band = spoonsValueBand(row.milliunits, modalMilliunits);
              return (
                <tr key={row.id}>
                  <td className="spoonsTableRank">{row.rank}</td>
                  <th scope="row" className="spoonsTablePub">
                    {href ? (
                      <Link href={href}>{row.name}</Link>
                    ) : (
                      <span>{row.name}</span>
                    )}
                    <span className="spoonsTableWhere">
                      {[row.town, row.county].filter(Boolean).join(", ")}
                    </span>
                    <span className="spoonsTableRound">
                      {`${row.round}, `}
                      <span className="spoonsTableCost">{formatBasketCost(row.pence)}</span>
                    </span>
                  </th>
                  <td className="spoonsTableUnits">
                    <span className={`spoonsTableUnitsFigure ${spoonsValueBandClass(band)}`}>
                      {formatUnitsLabel(row.milliunits)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
