"use client";

import Link from "next/link";
import { Ellipsis, List, LocateFixed, Route, Search, SlidersHorizontal, Sparkles, TrainFront, X } from "lucide-react";
import { useCallback } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { buildFiltersChip, buildNearMeChip, buildTflCorner } from "@/lib/mapChromeTiers";
import type { MapOverlay, MapSheetKind } from "@/lib/mobileShell";

import "./mobileMapShell.css";

const SHEET_TITLES: Partial<Record<MapOverlay, string>> = {
  filters: "Drinks and price",
  tfl: "TfL live",
  tonight: "Tonight",
  layers: "Map layers",
  "pub-pal": "Pub Pal",
  moment: "Choose a pub",
  "near-me": "Cheapest pints near you",
};

const CONTEXTUAL_SHEETS: readonly MapSheetKind[] = [
  "filters",
  "tfl",
  "tonight",
  "layers",
  "pub-pal",
  "moment",
  "near-me",
];

function PalSignalAvatar() {
  return (
    <span className="mobilePalAvatar" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        <path className="mobilePalAvatarBack" d="m11 14-5-5 2 13m21-8 5-5-2 13" />
        <path className="mobilePalAvatarHead" d="M8 17c2-12 22-12 24 0 2 12-4 19-12 19S6 29 8 17Z" />
        <path className="mobilePalAvatarMuzzle" d="M14 24c3-3 9-3 12 0 2 5-1 8-6 8s-8-3-6-8Z" />
        <circle cx="15" cy="20" r="1.6" /><circle cx="25" cy="20" r="1.6" />
        <path d="M18 25h4l-2 2Z" />
      </svg>
    </span>
  );
}

export default function MobileMapShell({ cityLabel, overlay, onOverlayChange, activeQuery, onClearQuery, onNearMe, nearMeStatus, nearbyCount, tonightCount, tflCount, tflStatus, priceLabel, drinkFiltersActive, priceCapActive, zoneActive, listOpen, onListToggle, planOpen, planActive, planStopCount, planInteractive, onPlan, searchContent, filtersContent, tflContent, tonightContent, layersContent, palContent, momentContent, nearMeContent }: {
  cityLabel: string;
  overlay: MapOverlay;
  onOverlayChange: (overlay: MapOverlay) => void;
  /** #395 R1: the live map search query (restored or typed), trimmed. Empty = no filter. */
  activeQuery: string;
  /** Clears the query and unfilters the map. */
  onClearQuery: () => void;
  onNearMe: () => void;
  nearMeStatus: "idle" | "requesting" | "ready" | "error";
  nearbyCount: number;
  tonightCount: number;
  tflCount: number;
  tflStatus: "checking" | "clear" | "issues" | "unavailable";
  priceLabel: string;
  drinkFiltersActive: boolean;
  /** #329 zone lens counts as a filters refinement (its mobile home is the filters sheet). */
  zoneActive?: boolean;
  /** #346 adoption: the a11y List view's toggle lives in the utility corner on mobile. */
  listOpen?: boolean;
  onListToggle?: () => void;
  priceCapActive: boolean;
  planOpen: boolean;
  planActive: boolean;
  planStopCount: number;
  planInteractive: boolean;
  onPlan: () => void;
  searchContent: React.ReactNode;
  filtersContent: React.ReactNode;
  tflContent: React.ReactNode;
  tonightContent: React.ReactNode;
  layersContent: React.ReactNode;
  palContent: React.ReactNode;
  momentContent: React.ReactNode;
  nearMeContent: React.ReactNode;
}) {
  const set = (next: MapOverlay) => onOverlayChange(overlay === next ? "none" : next);
  const closeSheet = useCallback(() => onOverlayChange("none"), [onOverlayChange]);
  const nearMe = buildNearMeChip(nearMeStatus, nearbyCount);
  const filtersChip = buildFiltersChip({ drinkFiltersActive, priceCapActive, priceLabel, zoneActive });
  const tflCorner = buildTflCorner(tflStatus, tflCount);
  const sheetKind = CONTEXTUAL_SHEETS.includes(overlay as MapSheetKind)
    ? (overlay as MapSheetKind)
    : null;
  const sheetContent = sheetKind === "filters" ? filtersContent : sheetKind === "tfl" ? tflContent : sheetKind === "tonight" ? tonightContent : sheetKind === "layers" ? layersContent : sheetKind === "moment" ? momentContent : sheetKind === "near-me" ? nearMeContent : palContent;

  return (
    <>
      <div className="mobileMapChrome" aria-label="Map controls">
        <header className="mobileMapTopbar">
          <Link href="/" className="mobileMapBrand" aria-label="Open PUBMAXX landing page"><PubmaxxWordmark /></Link>
          <span className="mobileMapCity">{cityLabel}</span>
          <IconButton aria-label="Search the map" aria-expanded={overlay === "search"} onClick={() => set("search")}><Search size={19} /></IconButton>
          <IconButton className="mobileMapPalButton" aria-label="Open Pub Pal" aria-expanded={overlay === "pub-pal"} onClick={() => set("pub-pal")}><PalSignalAvatar /></IconButton>
          <IconButton aria-label="More map controls" aria-expanded={overlay === "layers"} onClick={() => set("layers")}><Ellipsis size={20} /></IconButton>
        </header>

        {overlay === "search" ? (
          <div className="mobileMapSearchRow">{searchContent}</div>
        ) : (
          <nav className="mobileMapRail" aria-label="Contextual map controls">
            {/* TIER 1 — the answer. The only primary-weight chip on the map. */}
            <Chip className="mobileMapChipPrimary" aria-pressed={nearMe.pressed} disabled={nearMe.disabled} onClick={onNearMe}><LocateFixed size={17} />{nearMe.label}</Chip>
            {/* TIER 2 — answer-adjacent surfaces. Filters absorbs the old
                Drinks + price chips (both always opened this same sheet); the
                zone picker joins as a sheet section when that lane lands. */}
            <Chip aria-pressed={overlay === "tonight"} onClick={() => set("tonight")}><Sparkles size={17} />Tonight{tonightCount ? <span className="mobileMapChipCount">{tonightCount}</span> : null}</Chip>
            <Chip aria-pressed={overlay === "filters"} aria-label={filtersChip.ariaLabel} onClick={() => set("filters")}><SlidersHorizontal size={17} />{filtersChip.label}{filtersChip.refinements ? <span className="mobileMapChipCount">{filtersChip.refinements}</span> : null}</Chip>
          </nav>
        )}
        {/* #395 R1 — active-search chip. When a query filters the map (restored
            session OR typed) and the search field is closed, surface it as a
            dismissible chip so the filter is never invisible. Tapping it clears
            the query and restores every pin. */}
        {overlay !== "search" && activeQuery ? (
          <div className="mobileMapQueryRow">
            <button
              type="button"
              className="mobileMapQueryChip"
              onClick={onClearQuery}
              aria-label={`Clear pub search: ${activeQuery}`}
            >
              <Search size={15} aria-hidden="true" />
              <span className="mobileMapQueryChipText">{activeQuery}</span>
              <X size={16} aria-hidden="true" className="mobileMapQueryChipDismiss" />
            </button>
          </div>
        ) : null}
      </div>
      {/* TIER 3 — utilities live in the map's corner, out of the answer's way.
          List view (#346) joins this stack on its rebase. */}
      {overlay !== "search" ? (
        <div className="mobileMapUtilityCorner" aria-label="Map utilities">
          <IconButton aria-label={tflCorner.ariaLabel} aria-expanded={overlay === "tfl"} onClick={() => set("tfl")}>
            <TrainFront size={19} />
            {tflCorner.statusSuffix ? <span className="mobileMapCornerSuffix" aria-hidden="true">{tflCorner.statusSuffix}</span> : null}
            {tflCorner.badge ? <span className="mobileMapCornerBadge">{tflCorner.badge}</span> : null}
          </IconButton>
          {onListToggle ? (
            <IconButton aria-label="List view of pubs on the map" aria-pressed={Boolean(listOpen)} onClick={onListToggle}>
              <List size={19} />
            </IconButton>
          ) : null}
        </div>
      ) : null}
      {overlay === "none" && !planOpen ? (
        <button
          type="button"
          className={`mobilePlanActivation${planActive ? " isActive" : ""}`}
          aria-label={planActive ? `Edit active ${planStopCount}-stop plan` : "Describe your night"}
          disabled={!planInteractive}
          onClick={onPlan}
        >
          <Route size={19} aria-hidden="true" />
          <span>
            <strong>{planActive ? `${planStopCount}-stop plan` : "Describe your night"}</strong>
            {planActive ? <small>Edit route</small> : null}
          </span>
        </button>
      ) : null}
      <Sheet kind={sheetKind} title={sheetKind ? SHEET_TITLES[sheetKind] ?? "Map controls" : "Map controls"} initialSnap={sheetKind === "moment" || sheetKind === "layers" || sheetKind === "near-me" ? "full" : "half"} onClose={closeSheet}>{sheetContent}</Sheet>
    </>
  );
}
