"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import {
  applySpoonsValueCut,
  formatBasketCost,
  formatUnitsLabel,
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
 *
 * UNITS ARE NOT A PRICE. The figure at the row's end is set as a plain figure
 * in the data face, not in a price band's chip: a green "15.7 units" read as a
 * cheap pint (taste plan, 18 Oct 2026). The map's Spoons lens still colours
 * its pins by the modal round; that is a map key, and it says so.
 */
export default function SpoonsValueTable({
  rows,
  cuts,
}: {
  rows: readonly SpoonsValueTableRow[];
  cuts: readonly SpoonsValueCut[];
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
              return (
                <tr key={row.id}>
                  <td className="spoonsTableRank">{row.rank}</td>
                  {/* The cell stays a table cell; the lines inside it stack in a
                      block of their own. A grid on the cell itself took it out
                      of the row, so the row's hairline stopped short of the
                      rank column. */}
                  <th scope="row" className="spoonsTablePub">
                    <span className="spoonsTablePubLines">
                      {href ? (
                        <Link href={href} prefetch={false}>
                          {row.name}
                        </Link>
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
                    </span>
                  </th>
                  <td className="spoonsTableUnits">
                    <span className="spoonsTableUnitsFigure">
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
