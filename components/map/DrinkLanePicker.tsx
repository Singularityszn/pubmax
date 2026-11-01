"use client";

import Link from "next/link";

import DrinkCoverage, { type MapDrinkCoverage } from "@/components/map/DrinkCoverage";

import { GlassWater, X } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { MAP_DRINK_LANES } from "@/lib/drinkLanes";
import type { DrinkCategory } from "@/lib/drinks";
import { findSubtype } from "@/lib/drinkSubtypes";
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
  status = "ready",
  coverage,
  variant = "panel",
  onChange,
  onClose,
}: {
  lane: DrinkCategory;
  /** How complete the selected lane's cross-venue read was, for the note. */
  status?: CategoryPriceIndexStatus;
  coverage?: MapDrinkCoverage;
  variant?: "panel" | "sheet";
  onChange: (lane: DrinkCategory) => void;
  onClose?: () => void;
}) {
  const lucia = findSubtype("soft-drink-lucia-special");
  const active = MAP_DRINK_LANES.find((option) => option.category === lane);
  // A lane still loading, or one we could not read, must not be worded as a
  // settled map. The default pint lane has no cross-venue index to report on.
  const note = active?.isDefault
    ? null
    : drinkLensCoverageNote(active?.noun ?? "this drink", status);

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
          <GlassWater size={16} aria-hidden="true" />
          <span>What are you drinking?</span>
          {onClose ? (
            <IconButton variant="ghost" className="drinkLanePickerClose" aria-label="Close drink choices" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
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
              {option.label}
            </button>
          );
        })}
      </div>
      {/* Lucia lives under soft drinks: the one shortcut this picker carries,
          on the phone sheet and the desktop panel alike, straight to its
          listed prices. */}
      {lucia ? (
        <Link
          prefetch={false}
          href="/soft-drinks-and-water?sub=soft-drink-lucia-special"
          className="drinkLanePickerLucia"
        >
          <span className="drinkLanePickerLuciaLane">Soft drinks</span>
          <strong>{lucia.label}</strong>
          <span>{lucia.longLabel} prices</span>
        </Link>
      ) : null}
      {/* What the chosen lane can and cannot do. The pint lane keeps the map it
          always had; every other lane colours pins only where drinkers have
          logged and confirmed that drink, so its silence is honest rather than
          a claim that a pub sells none. */}
      <p className="drinkLanePickerNote">
        {active?.isDefault
          ? "Pin colours follow the cheapest pint on record."
          : `Pin colours follow confirmed ${active?.noun ?? "drink"} prices that drinkers logged. Pubs without one stay unknown.`}
      </p>
      {coverage ? <DrinkCoverage category={lane} coverage={coverage} /> : null}
      {!coverage && note ? (
        <p className="drinkLanePickerStatus" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}
    </section>
  );
}
