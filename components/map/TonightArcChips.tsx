"use client";

import {
  toggleVenueKind,
  type CuratedVenueKind,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";

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
  onChange,
}: {
  visibility: VenueKindVisibility;
  onChange: (next: VenueKindVisibility) => void;
}) {
  return (
    <div
      className="tonightArcChips"
      role="group"
      aria-label="Tonight arc venue types"
    >
      <span className="tonightArcLabel">Tonight arc</span>
      <div className="tonightArcRow">
        {CHIPS.map((chip) => {
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
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
