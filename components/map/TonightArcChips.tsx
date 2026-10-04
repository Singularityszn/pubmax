"use client";

import {
  toggleVenueKind,
  type CuratedVenueKind,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";

import "./tonightArcChips.css";

// The kinds the map's own filter offers, and no more. A "Clubs" chip stood
// here permanently disabled, explained by a `title` attribute no phone shows
// (docs/proof/astra-live-walk/report.md B9). It could never be enabled, so it
// went: `curatedVenueKind` in lib/venueKindFilters.ts files a club under the
// bars, and the Bars chip shows and hides clubs with them.
const CHIPS: ReadonlyArray<{
  kind: CuratedVenueKind;
  label: string;
}> = [
  { kind: "pub", label: "Pints" },
  { kind: "bar", label: "Bars" },
  { kind: "food", label: "Food" },
  { kind: "restaurant", label: "Restaurants" },
];

export default function TonightArcChips({
  visibility,
  experienceLens = "all",
  variant = "popover",
  onChange,
}: {
  visibility: VenueKindVisibility;
  experienceLens?: MapExperienceLens;
  /**
   * Where the toggles are read.
   *
   * "popover" is the desktop home: inside the toolbar's own Filters panel,
   * which the reader opens (PlanAstra item 9). They used to FLOAT over the
   * desktop map as a permanent band, one of the 20 to 24 controls a tablet met
   * before it had tapped a pin. "sheet" is the phone home: the Filters sheet,
   * beside "Show me". A viewport gets ONE of the two, never both (design
   * judgement 2026-08-01, finding 2.3).
   */
  variant?: "popover" | "sheet";
  onChange: (next: VenueKindVisibility) => void;
}) {
  const chips =
    experienceLens === "food"
      ? CHIPS.filter(
          (chip) => chip.kind === "food" || chip.kind === "restaurant",
        )
      : CHIPS;
  return (
    <div
      className={
        variant === "sheet"
          ? "tonightArcChips tonightArcChipsSheet"
          : "tonightArcChips tonightArcChipsPopover"
      }
      role="group"
      /* Reader words, not the component's name. "Tonight arc" is what this file
         is called; it printed on the map and in the accessibility tree, which
         docs/VOICE.md rule 2 bans. The chips name the venue types themselves,
         so the group needs no title above them, only this accessible name.
         Two lanes named this group at once. This one wins because it is the
         shorter of the two and the group is already known to be on the map;
         __tests__/voiceComplianceAudit.test.ts was amended to expect it. */
      aria-label="Venue types"
    >
      <div className="tonightArcRow">
        {chips.map((chip) => {
          const on = visibility[chip.kind];
          return (
            <button
              key={chip.kind}
              type="button"
              className={on ? "tonightArcChip isOn" : "tonightArcChip"}
              aria-pressed={on}
              onClick={() => onChange(toggleVenueKind(visibility, chip.kind))}
            >
              {/* The tick, not a colour, marks selection (aria-pressed already
                  names it for readers, so the glyph stays decorative). */}
              {on ? (
                <span className="tonightArcChipTick" aria-hidden="true">
                  ✓
                </span>
              ) : null}
              <span className="tonightArcChipLabel">
                {experienceLens === "no-alcohol" && chip.kind === "pub"
                  ? "Pubs"
                  : chip.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
