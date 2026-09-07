"use client";

// The desktop map's venue-type filter, behind ONE control (PlanAstra item 9).
//
// The five kind chips used to float over the map as a permanent band at every
// width from 641px up, so a tablet met 20 to 24 controls before it had tapped a
// pin. They are the same chips, read through the same state; what changed is
// that the reader opens them. The closed control carries the count of the kinds
// switched off, because a closed panel may not hide which pins the map is
// leaving out - the same rule the "Show me" and "Drink" controls beside it keep.

import { SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";

import type { MapExperienceLens } from "@/lib/mapExperienceLens";
import {
  hiddenVenueKindCount,
  showAllVenueKinds,
  venueKindFilterAriaLabel,
  venueKindFilterLabel,
  type VenueKindVisibility,
} from "@/lib/venueKindFilters";

import "./mapVenueKindFilter.css";

/* The chips ride the reader's own tap, never the map's cold start: the closed
   control is one button, and its panel is what costs a chunk. */
const TonightArcChips = dynamic(
  () => import("@/components/map/TonightArcChips"),
  { ssr: false },
);

export default function MapVenueKindFilter({
  visibility,
  experienceLens = "all",
  onChange,
}: {
  visibility: VenueKindVisibility;
  experienceLens?: MapExperienceLens;
  onChange: (next: VenueKindVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hidden = hiddenVenueKindCount(visibility, experienceLens);

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
      className={open ? "mapVenueKindFilter isOpen" : "mapVenueKindFilter"}
      ref={rootRef}
    >
      <button
        type="button"
        ref={buttonRef}
        className={
          open || hidden > 0
            ? "mapVenueKindFilterBtn isActive"
            : "mapVenueKindFilterBtn"
        }
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={venueKindFilterAriaLabel(hidden)}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span>{venueKindFilterLabel(hidden)}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="mapVenueKindFilterPanel"
          role="dialog"
          aria-label="Filters"
        >
          <TonightArcChips
            visibility={visibility}
            experienceLens={experienceLens}
            variant="popover"
            onChange={onChange}
          />
          {hidden > 0 ? (
            <button
              type="button"
              className="mapVenueKindFilterReset"
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
