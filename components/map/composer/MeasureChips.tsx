"use client";

import { useId } from "react";

import {
  DRINK_MEASURES,
  DRINK_MEASURE_LABEL,
  DRINK_MEASURE_LABEL_MAX,
  MEASURE_FIELD_LABEL,
  MEASURE_OTHER_PLACEHOLDER,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";

import styles from "@/components/map/measureChips.module.css";

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
export default function MeasureChips({
  measure,
  measureLabel,
  onChange,
  fieldLabel = MEASURE_FIELD_LABEL,
  disabled = false,
}: MeasureChipsProps) {
  const groupId = useId();
  const labelInputId = `${groupId}-label`;

  return (
    <div className={styles.measureField}>
      <span className={styles.measureFieldLabel} id={`${groupId}-measure`}>
        {fieldLabel}
      </span>
      <div
        className={styles.measureChips}
        role="radiogroup"
        aria-labelledby={`${groupId}-measure`}
      >
        {DRINK_MEASURES.map((option) => {
          const selected = measure === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              className={selected ? `${styles.measureChip} ${styles.selected}` : styles.measureChip}
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
        })}
      </div>
      {measure === "other" ? (
        <label className={styles.measureLabelField} htmlFor={labelInputId}>
          <span className={styles.srOnly}>What measure was it?</span>
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
