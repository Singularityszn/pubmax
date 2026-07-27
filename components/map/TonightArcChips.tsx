"use client";

import {
  toggleVenueKind,
  type CuratedVenueKind,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";

import "./tonightArcChips.css";

const CHIPS: ReadonlyArray<{
  kind: CuratedVenueKind | "club";
  label: string;
  disabled?: boolean;
}> = [
  { kind: "pub", label: "Pints" },
  { kind: "bar", label: "Bars" },
  { kind: "club", label: "Clubs", disabled: true },
  { kind: "food", label: "Food" },
  { kind: "restaurant", label: "Restaurants" },
];

export default function TonightArcChips({
  visibility,
  experienceLens = "all",
  onChange,
}: {
  visibility: VenueKindVisibility;
  experienceLens?: MapExperienceLens;
  onChange: (next: VenueKindVisibility) => void;
}) {
  const chips =
    experienceLens === "food"
      ? CHIPS.filter(
          (chip) => chip.kind === "food" || chip.kind === "restaurant",
        )
      : CHIPS.filter((chip) => experienceLens === "all" || chip.kind !== "club");
  return (
    <div
      className="tonightArcChips"
      role="group"
      aria-label="Tonight arc venue types"
    >
      <span className="tonightArcLabel">Tonight arc</span>
      <div className="tonightArcRow">
        {chips.map((chip) => {
          const on = chip.kind === "club" ? false : visibility[chip.kind];
          return (
            <button
              key={chip.kind}
              type="button"
              className={on ? "tonightArcChip isOn" : "tonightArcChip"}
              aria-pressed={on}
              disabled={chip.disabled}
              title={chip.disabled ? "Clubs arrive in Wave 2" : undefined}
              onClick={() => {
                if (chip.kind !== "club") {
                  onChange(toggleVenueKind(visibility, chip.kind));
                }
              }}
            >
              {experienceLens === "no-alcohol" && chip.kind === "pub"
                ? "Pubs"
                : chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
