"use client";

import { Beer, ForkKnife, Martini, Music, Utensils, type LucideIcon } from "lucide-react";

import {
  offeredVenueKinds,
  toggleVenueKind,
  type CuratedVenueKind,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";

import "./tonightArcChips.css";

// One reachable control for each kind the map offers. Legacy Club visibility
// follows Bars until the reader makes an explicit Club choice.
const CHIPS: ReadonlyArray<{
  kind: CuratedVenueKind;
  label: string;
  Icon: LucideIcon;
}> = [
  { kind: "pub", label: "Pubs", Icon: Beer },
  { kind: "bar", label: "Bars", Icon: Martini },
  { kind: "club", label: "Clubs", Icon: Music },
  { kind: "food", label: "Late food", Icon: Utensils },
  { kind: "restaurant", label: "Restaurants", Icon: ForkKnife },
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
  const offeredKinds = offeredVenueKinds(experienceLens);
  const chips = CHIPS.filter((chip) => offeredKinds.includes(chip.kind));
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
          const on = chip.kind === "club"
            ? (visibility.club ?? visibility.bar)
            : visibility[chip.kind];
          const Icon = chip.Icon;
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
              <Icon size={14} aria-hidden="true" />
              <span className="tonightArcChipLabel">
                {chip.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
