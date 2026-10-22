"use client";

import { GlassWater } from "lucide-react";

import { MAP_DRINK_LANES } from "@/lib/drinkLanes";
import { parseDrinkSubtypeParam } from "@/lib/drinkSubtypes";
import type { DrinkCategory } from "@/lib/drinks";
import {
  drinkLensCoverageNote,
  type CategoryPriceIndexStatus,
} from "@/lib/mapExperienceLens";

import "./drinkLanePicker.css";

/**
 * The drink the map is under, as a control the reader can see.
 *
 * It used to be a `<select>` labelled "Drink" tucked beside the pint-brand
 * picker, and on a phone it was two taps inside the Filters sheet. A map that
 * is showing cocktail prices is a different map, so the choice is a named
 * control of its own at both sizes and its options are all visible at once.
 *
 * The table it renders is `MAP_DRINK_LANES`, so it cannot offer a drink the map
 * has no honest label or figure for, and it cannot name one differently from
 * the picker on the other viewport.
 */
export default function DrinkLanePicker({
  lane,
  drinkSubtype,
  status = "ready",
  variant = "panel",
  onChange,
  servingGroups = [],
  servingGroup = null,
  onServingGroupChange,
}: {
  lane: DrinkCategory;
  drinkSubtype?: string | null;
  /** How complete the selected lane's cross-venue read was, for the note. */
  status?: CategoryPriceIndexStatus;
  variant?: "panel" | "sheet";
  onChange: (lane: DrinkCategory) => void;
  servingGroups?: readonly string[];
  servingGroup?: string | null;
  onServingGroupChange?: (serving: string | null) => void;
}) {
  const active = MAP_DRINK_LANES.find((option) => option.category === lane);
  const subtype = parseDrinkSubtypeParam(drinkSubtype, lane);
  const restingPints = active?.isDefault && !subtype;
  // A lane still loading, or one we could not read, must not be worded as a
  // settled map. The default pint lane has no cross-venue index to report on.
  const note = restingPints
    ? null
    : drinkLensCoverageNote(subtype?.longLabel.toLowerCase() ?? active?.noun ?? "this drink", status);

  return (
    <section
      className={
        variant === "sheet"
          ? "drinkLanePicker drinkLanePicker--sheet"
          : "drinkLanePicker"
      }
      aria-label="Drink lane"
    >
      {/* The phone sheet's chrome already prints the one heading this surface
          gets (MAP_SHEET_TITLES), so the panel copy carries it only where there
          is no chrome above it. */}
      {variant === "sheet" ? null : (
        <div className="drinkLanePickerHead">
          <GlassWater size={15} aria-hidden="true" />
          <span>What are you drinking?</span>
        </div>
      )}
      <div
        className="drinkLanePickerOptions"
        role="group"
        aria-label="Drink prices shown on the map"
      >
        {MAP_DRINK_LANES.map((option) => {
          const selected = option.category === lane;
          return (
            <button
              key={option.category}
              type="button"
              className={
                selected
                  ? "drinkLanePickerOption isSelected"
                  : "drinkLanePickerOption"
              }
              aria-pressed={selected}
              onClick={() => onChange(option.category)}
            >
              {selected && subtype ? subtype.longLabel : option.label}
            </button>
          );
        })}
      </div>
      {!restingPints && onServingGroupChange ? (
        <>
          <p className="drinkLanePickerNote">Choose a serving size to compare menu prices.</p>
          <div className="drinkLanePickerOptions" role="group" aria-label="Serving size for price comparison">
            <button type="button" className={`drinkLanePickerOption${servingGroup === null ? " isSelected" : ""}`}
              aria-pressed={servingGroup === null} onClick={() => onServingGroupChange(null)}>All servings · unranked</button>
            {servingGroups.map((group) => <button key={group} type="button"
              className={`drinkLanePickerOption${servingGroup === group ? " isSelected" : ""}`}
              aria-pressed={servingGroup === group} onClick={() => onServingGroupChange(group)}>{group}</button>)}
          </div>
        </>
      ) : null}
      {/* The resting pint lane keeps its original bands. A selected subtype
          compares its own stated serving and never borrows community rows. */}
      <p className="drinkLanePickerNote">
        {restingPints
          ? "Pin colours follow the cheapest pint on record."
          : subtype ? "Other servings stay visible, unranked."
          : "Other servings and community reports stay visible, unranked."}
      </p>
      {note ? (
        <p className="drinkLanePickerStatus" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}
    </section>
  );
}
