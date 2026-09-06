"use client";

import Link from "next/link";

import {
  SPOONS_VALUE_LENS_LABEL,
  SPOONS_VALUE_RESPONSIBLE_LINE,
  SPOONS_VALUE_ROUTE,
  formatUnits,
  spoonsValueBandClass,
  spoonsValueBandLabel,
  spoonsValueBandLegendLabel,
  SPOONS_VALUE_BANDS,
  type SpoonsValueLensState,
} from "@/lib/spoonsValue";

import "./spoonsValueLens.css";

/**
 * The Spoons value lens, as a control the reader can see.
 *
 * It lives under the drink lanes rather than beside them because it answers a
 * different question: not which drink the map is priced in, but what a tenner
 * buys in the one chain that publishes the same menu everywhere. Same chip
 * shape as its neighbour, so the two read as one control panel.
 *
 * The legend prints the number each band was cut at rather than only the
 * colours, the way the price legend does, because a colour nobody can put a
 * figure to is decoration.
 */
export default function SpoonsValueLensControl({
  on,
  state,
  variant = "panel",
  onChange,
}: {
  on: boolean;
  state: SpoonsValueLensState;
  variant?: "panel" | "sheet";
  onChange: (on: boolean) => void;
}) {
  const modal = state.modalMilliunits;
  return (
    <section
      className={
        variant === "sheet"
          ? "spoonsValueLens spoonsValueLens--sheet"
          : "spoonsValueLens"
      }
      aria-label={SPOONS_VALUE_LENS_LABEL}
    >
      <div className="spoonsValueLensRow">
        <button
          type="button"
          className={on ? "spoonsValueLensToggle isOn" : "spoonsValueLensToggle"}
          aria-pressed={on}
          onClick={() => onChange(!on)}
        >
          {SPOONS_VALUE_LENS_LABEL}
        </button>
        <Link className="spoonsValueLensLink" href={SPOONS_VALUE_ROUTE}>
          See the ranking
        </Link>
      </div>

      {on && state.status === "ready" && modal !== null ? (
        <>
          <ul className="spoonsValueLensLegend">
            {SPOONS_VALUE_BANDS.map((band) => (
              <li key={band}>
                <span
                  className={`spoonsValueLensSwatch ${spoonsValueBandClass(band)}`}
                  aria-hidden="true"
                />
                <span className="spoonsValueLensBand">{spoonsValueBandLabel(band)}</span>
                <span className="spoonsValueLensFigure">
                  {spoonsValueBandLegendLabel(band, modal)}
                </span>
              </li>
            ))}
          </ul>
          <p className="spoonsValueLensNote">
            {`Units the best £10 round holds. Most pubs pour ${formatUnits(modal)}. `}
            {SPOONS_VALUE_RESPONSIBLE_LINE}
          </p>
        </>
      ) : null}

      {on && state.status !== "ready" ? (
        <p className="spoonsValueLensNote" role="status" aria-live="polite">
          {state.status === "loading"
            ? "Reading the ranking."
            : state.status === "empty"
              ? "Nothing is ranked here yet."
              : "The ranking would not load. Turn the lens off and on to ask again."}
        </p>
      ) : null}
    </section>
  );
}
