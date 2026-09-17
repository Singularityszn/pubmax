"use client";


import { useTrailingEdgeFade } from "@/lib/useTrailingEdgeFade";
import type { Venue } from "@/lib/venues";
import type { TabKey } from "@/lib/venueInspectorTabs";
import { venueKindLabel, venueKindNoun } from "@/lib/venueKindFilters";
import VenueTonightChips from "@/components/map/VenueTonightChips";
import VenueImage from "@/components/media/VenueImage";
import venueImageStyles from "@/components/media/venueImage.module.css";
import sheetStyles from "../venueSheet.module.css";

type TabDef = { key: TabKey; label: string; shortLabel: string };

type VenueInspectorHeaderProps = {
  venue: Venue;
  /** Most recent community Pint Drop photo for this venue (E3′ fallback source). */
  communityPhotoUrl?: string | null;
  TABS: TabDef[];
  tab: TabKey;
  tabRefs: React.MutableRefObject<Record<TabKey, HTMLButtonElement | null>>;
  selectTab: (key: TabKey) => void;
  onTabKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) => void;
  onGrabDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragMove?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragEnd?: (event: React.PointerEvent<HTMLElement>) => void;
  onTabStripScroll?: () => void;
  revealBloom?: boolean;
  revealChecked?: boolean;
  revealCheckedLate?: boolean;
};

export default function VenueInspectorHeader({
  venue,
  communityPhotoUrl,
  TABS,
  tab,
  tabRefs,
  selectTab,
  onTabKeyDown,
  onGrabDragStart,
  onGrabDragMove,
  onGrabDragEnd,
  onTabStripScroll,
  revealBloom = false,
  revealChecked = false,
  revealCheckedLate = false,
}: VenueInspectorHeaderProps) {
  const { ref: tabStripRef, faded } = useTrailingEdgeFade<HTMLDivElement>();

  return (
    <>
      {/* The grab handle is the primary drag surface on mobile — a generous
          hit area (not just the thin visual bar) so it's easy to grab with a
          thumb. Pointer handlers are optional props; when absent (e.g. any
          future non-map usage of this component) it's simply not draggable. */}
      <div
        className={sheetStyles.venueSheetGrabZone}
        onPointerDown={onGrabDragStart}
        onPointerMove={onGrabDragMove}
        onPointerUp={onGrabDragEnd}
        onPointerCancel={onGrabDragEnd}
      >
        <span className={sheetStyles.venueSheetGrab} aria-hidden="true" />
      </div>
      {/* The kicker is brand: where the pub is and what it is, never a label
          for the panel itself (site audit 13 Sep 2026, D21). */}
      <div className="inspectorTitle">
        <span>{`${venue.primaryBorough} · ${venueKindLabel(venue.kind)}`}</span>
      </div>
      <h3>{venue.name}</h3>

      {/* E3′ — shared provenance-labelled venue photo header: chain (scraped)
          photo first, honest community Pint Drop fallback, gradient
          placeholder for photo-less venues. Additive/self-contained so it does
          not touch the tab strip or grab-zone layout N3 owns below. */}
      <VenueImage
        className={`${venueImageStyles.venueImageHeader} ${sheetStyles.venueBaselinePhoto}${revealBloom ? " venueRevealBloom" : ""}`}
        sources={[
          { url: venue.imageUrl, provenance: "chain" },
          { url: communityPhotoUrl, provenance: "community" },
        ]}
        alt={`${venue.name} exterior or ${venueKindNoun(venue.kind)} interior photo`}
        width={720}
        height={420}
      />

      {/* What's on at this venue tonight (A1) — pure sheet DOM, fail-soft. */}
      <VenueTonightChips
        id={venue.id}
        name={venue.name}
        latitude={venue.latitude}
        longitude={venue.longitude}
        revealChecked={revealChecked}
        revealCheckedLate={revealCheckedLate}
      />

      {/* The right-edge fade is drawn only while something really is off the
          edge (lib/useTrailingEdgeFade.ts). A static mask left the last tab
          half-faded at the end of the scroll on a 390px phone, and half opacity
          is how this product draws a control a reader may not use. */}
      <div
        ref={tabStripRef}
        className={sheetStyles.venueTabs}
        onScroll={onTabStripScroll}
        data-trailing-fade={faded ? "on" : "off"}
        role="tablist"
        aria-label="Venue detail sections"
      >
        {TABS.map(({ key, label, shortLabel }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`venueTab-${key}`}
              aria-controls={`venuePanel-${key}`}
              aria-label={label}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={active ? `${sheetStyles.venueTab} ${sheetStyles.active}` : sheetStyles.venueTab}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              onClick={() => selectTab(key)}
              onKeyDown={(event) => onTabKeyDown(event, key)}
            >
              <span className={sheetStyles.venueTabFull}>{label}</span>
              <span className={sheetStyles.venueTabShort} aria-hidden="true">
                {shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
