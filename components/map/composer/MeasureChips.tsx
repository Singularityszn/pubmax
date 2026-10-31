"use client";

import { useId } from "react";

import {
  BEER_MEASURES,
  DRINK_MEASURE_LABEL,
  DRINK_MEASURE_LABEL_MAX,
  MEASURE_FIELD_LABEL,
  MEASURE_OTHER_PLACEHOLDER,
  WINE_AND_SPIRIT_MEASURES,
  WINE_AND_SPIRIT_MEASURES_HEADING,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";

import "@/components/map/measureChips.css";

type MeasureChipsProps = {
  measure: DrinkMeasure;
  measureLabel: string;
  onChange: (next: { measure: DrinkMeasure; measureLabel: string }) => void;
  /** Named for the reader when one screen holds more than one price door. */
  fieldLabel?: string;
  disabled?: boolean;
};

// ── THE ONE MEASURE CONTROL ────────────────────────────────────────────────
// The closed question "what serving is this price about?", asked in exactly one
// place so the two price doors cannot ask it two ways.
//
// Battle test D04 gave the Pint Drop composer this row; review finding F-2 found
// the OTHER door - the one-tap "What's it tonight?" card that #1517 made the
// single primary price door on a pub's Overview - still stamping `measure:
// "pint"` on a value nobody was asked. A second copy of these chips would have
// been a second vocabulary for one fact, so both doors mount this component and
// lib/drinkMeasure.ts stays the owner of the set and the words.
//
// Leaving `other` drops the free label with it: a word kept beside `pint` would
// be a second name for a measure that already names itself.
//
// THE ORDER IS THE BEER MEASURES, THEN THE GLASSES, THEN OTHER (review item B1).
// Pint and Half stay first because they are what most prices on this door are
// about; the glass and spirit sizes sit under their own heading so a wine
// price can say "175 ml" instead of hiding in `other`. One radio group still,
// because it is one question with one answer.
export default function MeasureChips({
  measure,
  measureLabel,
  onChange,
  fieldLabel = MEASURE_FIELD_LABEL,
  disabled = false,
}: MeasureChipsProps) {
  const groupId = useId();
  const labelInputId = `${groupId}-label`;

  const chip = (option: DrinkMeasure) => {
    const selected = measure === option;
    return (
      <button
        key={option}
        type="button"
        role="radio"
        aria-checked={selected}
        className={selected ? "measureChip selected" : "measureChip"}
        disabled={disabled}
        onClick={() =>
          onChange({
            measure: option,
            measureLabel: option === "other" ? measureLabel : "",
          })
        }
      >
        {DRINK_MEASURE_LABEL[option]}
      </button>
    );
  };

  return (
    <div className="measureField">
      <span className="measureFieldLabel" id={`${groupId}-measure`}>
        {fieldLabel}
      </span>
      <div
        className="measureChips"
        role="radiogroup"
        aria-labelledby={`${groupId}-measure`}
      >
        {BEER_MEASURES.map(chip)}
        <div
          className="measureChipGroup"
          role="group"
          aria-labelledby={`${groupId}-wine`}
        >
          <span className="measureGroupLabel" id={`${groupId}-wine`}>
            {WINE_AND_SPIRIT_MEASURES_HEADING}
          </span>
          {WINE_AND_SPIRIT_MEASURES.map(chip)}
        </div>
        {chip("other")}
      </div>
      {measure === "other" ? (
        <label className="measureLabelField" htmlFor={labelInputId}>
          <span className="srOnly">What measure was it?</span>
          <input
            id={labelInputId}
            value={measureLabel}
            maxLength={DRINK_MEASURE_LABEL_MAX}
            disabled={disabled}
            onChange={(event) =>
              onChange({ measure, measureLabel: event.target.value })
            }
            placeholder={MEASURE_OTHER_PLACEHOLDER}
          />
        </label>
      ) : null}
    </div>
  );
}
