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
  unavailableReason?: string;
}> = [
  { kind: "pub", label: "Pints" },
  { kind: "bar", label: "Bars" },
  { kind: "club", label: "Clubs", unavailableReason: "are not mapped yet" },
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
          const unavailable = chip.unavailableReason !== undefined;
          return (
            <button
              key={chip.kind}
              type="button"
              className={on ? "tonightArcChip isOn" : "tonightArcChip"}
              aria-pressed={on}
              aria-label={
                unavailable
                  ? `${chip.label} ${chip.unavailableReason}`
                  : undefined
              }
              disabled={unavailable}
              title={unavailable ? `${chip.label} ${chip.unavailableReason}` : undefined}
              onClick={() => {
                if (chip.kind !== "club") {
                  onChange(toggleVenueKind(visibility, chip.kind));
                }
              }}
            >
              {on ? (
                <span className="tonightArcChipSelected" aria-hidden="true">
                  ✓
                </span>
              ) : null}
              <span className="tonightArcChipLabel">
                <span>
                  {experienceLens === "no-alcohol" && chip.kind === "pub"
                    ? "Pubs"
                    : chip.label}
                </span>
                {unavailable ? (
                  <small className="tonightArcChipUnavailable">
                    {chip.unavailableReason}
                  </small>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
