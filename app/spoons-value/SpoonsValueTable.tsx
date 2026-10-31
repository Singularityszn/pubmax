"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";

import {
  applySpoonsValueCut,
  formatBasketCost,
  formatUnitsLabel,
  formatRoundLine,
  spoonsValueMapHref,
  type SpoonsValueCut,
  type SpoonsValueCutId,
  type SpoonsValueTableRow,
} from "@/lib/spoonsValue";

function RoundCosts({ row }: { row: SpoonsValueTableRow }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="spoonsRoundDetails" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Round costs</summary>
      {open ? (
        <>
          <ul>
            {row.lines.map((line, index) => (
              <li key={index}>
                <span>{formatRoundLine(line)}</span>
                <span>{formatBasketCost(line.linePricePence)} total · {formatUnitsLabel(line.lineMilliunits)}</span>
                {line.bundleLabel ? <span>{line.bundleLabel}</span> : null}
              </li>
            ))}
          </ul>
          <p>Round total {formatBasketCost(row.pence)} · {formatUnitsLabel(row.milliunits)}</p>
          {row.checkedAt ? <p>Source read {row.checkedAt.slice(0, 10)}. Prices may have changed.</p> : null}
        </>
      ) : null}
    </details>
  );
}

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
  const [query, setQuery] = useState("");
  const searchId = useId();
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GB");
    return applySpoonsValueCut(rows, cut).filter((row) =>
      [row.name, row.town, row.county, row.postcode].join(" ").toLocaleLowerCase("en-GB").includes(needle),
    );
  }, [rows, cut, query]);

  return (
    <>
      <div className="spoonsSearch">
        <label htmlFor={searchId}>Find a Spoons</label>
        <input
          id={searchId}
          type="search"
          placeholder="Pub, town or postcode"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
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
          <caption className="spoonsTableCaption" aria-live="polite">
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
            {shown.length === 0 ? (
              <tr><td colSpan={3}>
                <p>No pubs match this search.</p>
                <button type="button" className="spoonsTableCut" onClick={() => { setQuery(""); setCut("all"); }}>Show all pubs</button>
              </td></tr>
            ) : null}
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
                    <RoundCosts row={row} />
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
