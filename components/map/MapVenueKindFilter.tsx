"use client";

// The desktop map's Filters control: every question about WHICH pins the map is
// drawing, behind one button the reader opens.
//
// It started as the venue-type chips (PlanAstra item 9), which used to float
// over the map as a permanent band from 641px up. The 7 Sep walk then counted
// eighteen controls at 1440 before a pin had been tapped (B9), so the two other
// controls that narrow the same pin set moved in here beside them: "Show me",
// the experience lens, and the fare-zone picker. The phone has read all three
// in its own Filters sheet since 2026-08-01, so this is the same set in the
// same order at both widths.
//
// The closed control carries a COUNT of what is switched off, because a closed
// panel may not hide which pins the map is leaving out. The count now covers
// every refinement the panel holds, for the same reason it covered the kinds:
// a badge that counted one of three would say the map is unfiltered when it is
// not.

import { SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";

import MapExperienceLensControl from "@/components/map/MapExperienceLens";
import ZonePicker from "@/components/map/ZonePicker";
import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import {
  hiddenVenueKindCount,
  mapFilterRefinementCount,
  showAllVenueKinds,
  venueKindFilterAriaLabel,
  VENUE_KIND_FILTER_WORD,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";
import { parseZoneParam, type ZonePintIndex } from "@/lib/zones";

import styles from "./mapVenueKindFilter.module.css";

/* The chips ride the reader's own tap, never the map's cold start: the closed
   control is one button, and its panel is what costs a chunk. */
const TonightArcChips = dynamic(
  () => import("@/components/map/TonightArcChips"),
  { ssr: false },
);

export default function MapVenueKindFilter({
  visibility,
  experienceLens = "all",
  experienceSummary = "",
  lensAllSelected = true,
  onExperienceLensChange,
  zone = null,
  zoneIndex,
  onZoneChange,
  onChange,
}: {
  visibility: VenueKindVisibility;
  experienceLens?: MapExperienceLens;
  /** The lens's own one-line summary, as the toolbar row used to print it. */
  experienceSummary?: string;
  lensAllSelected?: boolean;
  onExperienceLensChange?: (lens: MapExperienceLens) => void;
  /**
   * `filters.zone`, or null where the map offers no fare zones. Only London
   * has them, and only while a drink lane is available, so the caller answers
   * null rather than this control guessing.
   */
  zone?: string | null;
  zoneIndex?: ZonePintIndex;
  onZoneChange?: (zone: string) => void;
  onChange: (next: VenueKindVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hidden = hiddenVenueKindCount(visibility, experienceLens);
  const zoneParsed = zone === null ? null : parseZoneParam(zone);
  const refinements = mapFilterRefinementCount({
    hiddenKinds: hidden,
    lensNarrowed: experienceLens !== "all",
    zoneNarrowed: zoneParsed !== null && zoneParsed !== "all",
  });

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Claim the key, so the map-level Escape (close drawer) does not also
      // fire, and hand focus back to the control the reader opened.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
    function onPointer(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  return (
    <div
      className={open ? `${styles.mapVenueKindFilter} isOpen` : styles.mapVenueKindFilter}
      ref={rootRef}
    >
      <button
        type="button"
        ref={buttonRef}
        className={
          open || refinements > 0
            ? "mapVenueKindFilterBtn isActive"
            : "mapVenueKindFilterBtn"
        }
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={venueKindFilterAriaLabel(refinements)}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        {/* The word goes under 900px, where the toolbar row is a budget and the
            search field is what pays for a longer label (the top bar drops its
            own "More" label in the same band). The count stays, and the
            accessible name carries the whole sentence at every width. */}
        <span className={styles.mapVenueKindFilterWord}>{VENUE_KIND_FILTER_WORD}</span>
        {refinements > 0 ? (
          <span className={styles.mapVenueKindFilterCount}>{refinements}</span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          className={styles.mapVenueKindFilterPanel}
          role="dialog"
          aria-label="Filters"
        >
          <TonightArcChips
            visibility={visibility}
            experienceLens={experienceLens}
            variant="popover"
            onChange={onChange}
          />
          {onExperienceLensChange ? (
            <MapExperienceLensControl
              lens={experienceLens}
              allSelected={lensAllSelected}
              summary={experienceSummary}
              onChange={onExperienceLensChange}
            />
          ) : null}
          {zone !== null && zoneIndex && onZoneChange ? (
            <ZonePicker
              zone={zone}
              onZoneChange={onZoneChange}
              index={zoneIndex}
              variant="inline"
            />
          ) : null}
          {hidden > 0 ? (
            <button
              type="button"
              className={styles.mapVenueKindFilterReset}
              onClick={() => onChange(showAllVenueKinds(visibility, experienceLens))}
            >
              Show all types
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
