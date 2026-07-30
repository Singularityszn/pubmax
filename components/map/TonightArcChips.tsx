"use client";

import { useId, useState } from "react";

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
  const unavailableReasonId = useId();
  const [revealedUnavailableKind, setRevealedUnavailableKind] = useState<
    CuratedVenueKind | "club" | null
  >(null);
  const chips =
    experienceLens === "food"
      ? CHIPS.filter(
          (chip) => chip.kind === "food" || chip.kind === "restaurant",
        )
      : CHIPS.filter((chip) => experienceLens === "all" || chip.kind !== "club");
  const revealedUnavailableChip = chips.find(
    (chip) => chip.kind === revealedUnavailableKind,
  );
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
          const unavailableRevealed =
            unavailable && revealedUnavailableKind === chip.kind;
          return (
            <button
              key={chip.kind}
              type="button"
              className={`tonightArcChip${on ? " isOn" : ""}${unavailable ? " isUnavailable" : ""}`}
              aria-pressed={on}
              aria-disabled={unavailable || undefined}
              aria-expanded={unavailable ? unavailableRevealed : undefined}
              aria-controls={unavailable ? unavailableReasonId : undefined}
              aria-label={
                unavailable
                  ? `${chip.label} ${chip.unavailableReason}`
                  : undefined
              }
              title={unavailable ? `${chip.label} ${chip.unavailableReason}` : undefined}
              onClick={() => {
                if (unavailable) {
                  setRevealedUnavailableKind(
                    unavailableRevealed ? null : chip.kind,
                  );
                  return;
                }
                setRevealedUnavailableKind(null);
                if (chip.kind !== "club") {
                  onChange(toggleVenueKind(visibility, chip.kind));
                }
              }}
            >
              <span className="tonightArcChipLabel">
                {experienceLens === "no-alcohol" && chip.kind === "pub"
                  ? "Pubs"
                  : chip.label}
              </span>
            </button>
          );
        })}
      </div>
      {revealedUnavailableChip?.unavailableReason ? (
        <span
          className="tonightArcUnavailableReason"
          id={unavailableReasonId}
          role="tooltip"
        >
          {revealedUnavailableChip.label}{" "}
          {revealedUnavailableChip.unavailableReason}
        </span>
      ) : null}
    </div>
  );
}
