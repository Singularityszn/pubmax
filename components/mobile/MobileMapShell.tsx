"use client";

import Link from "next/link";
import { Ellipsis, LocateFixed, LocateOff, Map as MapGlyph, Route, Search, SlidersHorizontal, TrainFront, X } from "lucide-react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { areaChipClaim, areaChipClaimPrefix, type MapPlaceOrigin } from "@/lib/areaButton";
import { buildFiltersChip, buildNearMeChip, buildTflCorner, type CornerUtilityModel, type PrimaryChipModel } from "@/lib/mapChromeTiers";
import { MAP_SHEET_TITLES, type MapOverlay, type MapSheetKind } from "@/lib/mobileShell";

import "./mobileMapShell.css";

const CONTEXTUAL_SHEETS: readonly MapSheetKind[] = [
  "filters",
  "tfl",
  "tonight",
  "layers",
  "pub-pal",
  "moment",
  "near-me",
  "area",
];

/**
 * The map edge, top to bottom: TfL at the top, Near me at the thumb.
 *
 * Near me is a round FAB rather than a bar chip because that is what a map
 * reader already knows a locate control looks like, and because the one top
 * bar has no room left at 320px (design judgement 2026-08-01, finding 2.3).
 * Its state stays in the accessible name: "Near me", "Locating", "Nearby 12",
 * "Try near me".
 */
function MapEdgeControls({
  tfl,
  tflOpen,
  onOpenTfl,
  nearMe,
  nearbyCount,
  onNearMe,
}: {
  tfl: CornerUtilityModel;
  tflOpen: boolean;
  onOpenTfl: () => void;
  nearMe: PrimaryChipModel;
  nearbyCount: number;
  onNearMe: () => void;
}) {
  return (
    <div className="mobileMapUtilityCorner" aria-label="Map utilities">
      <IconButton className="mobileMapTflButton" aria-label={tfl.ariaLabel} aria-expanded={tflOpen} onClick={onOpenTfl}>
        <TrainFront size={19} />
        {tfl.statusSuffix ? <span className="mobileMapCornerSuffix" aria-hidden="true">{tfl.statusSuffix}</span> : null}
        {tfl.badge ? <span className="mobileMapCornerBadge">{tfl.badge}</span> : null}
      </IconButton>
      <button
        type="button"
        className="mobileMapLocateFab"
        aria-label={nearMe.label}
        aria-pressed={nearMe.pressed}
        disabled={nearMe.disabled}
        onClick={onNearMe}
      >
        <LocateFixed size={20} aria-hidden="true" />
        {nearMe.pressed && nearbyCount ? (
          <span className="mobileMapCornerBadge" aria-hidden="true">{nearbyCount}</span>
        ) : null}
      </button>
    </div>
  );
}

export default function MobileMapShell({ cityLabel, cityLabelOrigin, limitedCoverage, overlay, onOverlayChange, backLabel, onBack, onHome, activeQuery, onClearQuery, onNearMe, nearMeStatus, nearMeError, onDismissNearMeError, nearbyCount, tflCount, tflStatus, priceLabel, drinkFiltersActive, experienceFilterLabel, priceCapActive, areaPriceNoun, zoneActive, wetherspoonsActive, planOpen, planActive, planStopCount, planInteractive, venueListOpen, bandNoticeOpen, onPlan, searchContent, filtersContent, tflContent, tonightContent, layersContent, palContent, momentContent, nearMeContent, areaContent }: {
  cityLabel: string;
  /**
   * Whether that name is where the READER is, or only what the map is looking
   * at. A granted location inside the named area earns "reader"; everything
   * else is "map". The chip carries the answer in its glyph and its accessible
   * name, because a location pin beside a place name reads as "you are here"
   * to a reader who never gave the map a location.
   */
  cityLabelOrigin: MapPlaceOrigin;
  /** Base-pub-only arrival: omit city-guide controls that cannot answer here. */
  limitedCoverage: boolean;
  overlay: MapOverlay;
  onOverlayChange: (overlay: MapOverlay) => void;
  /**
   * The way out, shared with every other surface in the product. Back returns
   * to the sheet that opened this one; Home leaves them all for the map. Back
   * is null when this sheet opened over the map, where the two are the same
   * journey (components/ui/surface-nav.tsx).
   */
  backLabel: string | null;
  onBack: () => void;
  onHome: () => void;
  /** #395 R1: the live map search query (restored or typed), trimmed. Empty = no filter. */
  activeQuery: string;
  /** Clears the query and unfilters the map. */
  onClearQuery: () => void;
  onNearMe: () => void;
  nearMeStatus: "idle" | "requesting" | "ready" | "error";
  /** Why Near me could not place the reader. Null while it can, or has not run. */
  nearMeError: string | null;
  /** Clears that message, so the map is never left holding a stale reason. */
  onDismissNearMeError: () => void;
  nearbyCount: number;
  tflCount: number;
  tflStatus: "checking" | "clear" | "issues" | "unavailable";
  priceLabel: string;
  drinkFiltersActive: boolean;
  experienceFilterLabel?: "no-alcohol view" | "food view";
  /** #329 zone lens counts as a filters refinement (its mobile home is the filters sheet). */
  zoneActive?: boolean;
  /** Directory-matched Wetherspoons identity filter. */
  wetherspoonsActive?: boolean;
  priceCapActive: boolean;
  areaPriceNoun: string;
  planOpen: boolean;
  planActive: boolean;
  planStopCount: number;
  planInteractive: boolean;
  venueListOpen: boolean;
  bandNoticeOpen: boolean;
  onPlan: () => void;
  searchContent: React.ReactNode;
  filtersContent: React.ReactNode;
  tflContent: React.ReactNode;
  tonightContent: React.ReactNode;
  layersContent: React.ReactNode;
  palContent: React.ReactNode;
  momentContent: React.ReactNode;
  nearMeContent: React.ReactNode;
  /** The Area sheet body (cheapest pints here + go somewhere else). */
  areaContent: React.ReactNode;
}) {
  // The glyph is half the claim. LocateFixed is this map's "you are here" mark
  // (the Near me chip wears it), so it may appear only when a granted location
  // sits inside the named area. Otherwise the chip wears the map itself.
  const areaGlyph =
    cityLabelOrigin === "reader" ? (
      <LocateFixed size={14} aria-hidden="true" />
    ) : (
      <MapGlyph size={14} aria-hidden="true" />
    );
  const areaClaim = areaChipClaim(cityLabelOrigin, cityLabel);

  if (limitedCoverage) {
    return (
      <div className="mobileMapChrome" aria-label="Map controls">
        <header className="mobileMapTopbar mobileMapTopbarLimited">
          <Link href="/" className="mobileMapBrand" aria-label="Open PUBMAXX landing page">
            <PubmaxxWordmark />
          </Link>
          <span className="mobileMapArea mobileMapAreaStatic">
            {areaGlyph}
            {/* The visible chip is one short name. The claim behind it is read
                out here, so a screen reader is told what the name IS. */}
            <span className="mobileMapAreaClaim">
              {areaChipClaimPrefix(cityLabelOrigin)}
            </span>
            <span className="mobileMapAreaLabel">{cityLabel}</span>
          </span>
        </header>
      </div>
    );
  }

  const set = (next: MapOverlay) => onOverlayChange(overlay === next ? "none" : next);
  const nearMe = buildNearMeChip(nearMeStatus, nearbyCount);
  const filtersChip = buildFiltersChip({
    drinkFiltersActive,
    experienceLabel: experienceFilterLabel,
    priceCapActive,
    priceLabel,
    zoneActive,
    wetherspoonsActive,
  });
  const tflCorner = buildTflCorner(tflStatus, tflCount);
  const sheetKind = CONTEXTUAL_SHEETS.includes(overlay as MapSheetKind)
    ? (overlay as MapSheetKind)
    : null;
  const sheetContent = sheetKind === "filters" ? filtersContent : sheetKind === "tfl" ? tflContent : sheetKind === "tonight" ? tonightContent : sheetKind === "layers" ? layersContent : sheetKind === "moment" ? momentContent : sheetKind === "near-me" ? nearMeContent : sheetKind === "area" ? areaContent : palContent;

  return (
    <>
      <div className="mobileMapChrome" aria-label="Map controls">
        {/* ONE top bar (design judgement 2026-08-01, finding 2.3). The old
            chrome stacked three containers: this bar, a Near me / Tonight /
            Filters rail, and a full-width category row. The category toggles
            now live in the Filters sheet beside "Show me", Near me is a round
            map-edge FAB, and Tonight keeps its two existing homes (the More
            sheet's Events tab and the tab bar). Six slots is what 320px holds
            at the 44px tap floor, so the bar cannot grow again in silence. */}
        <header className="mobileMapTopbar">
          <Link href="/" className="mobileMapBrand" aria-label="Open PUBMAXX landing page"><PubmaxxWordmark /></Link>
          <button
            type="button"
            className="mobileMapArea"
            aria-expanded={overlay === "area"}
            aria-haspopup="dialog"
            aria-label={`${areaClaim}. See its cheapest ${areaPriceNoun} or go somewhere else`}
            onClick={() => set("area")}
          >
            {areaGlyph}
            <span className="mobileMapAreaLabel">{cityLabel}</span>
          </button>
          <IconButton aria-label="Search the map" aria-expanded={overlay === "search"} onClick={() => set("search")}><Search size={19} /></IconButton>
          <IconButton
            className="mobileMapFiltersButton"
            aria-label={filtersChip.ariaLabel}
            aria-expanded={overlay === "filters"}
            onClick={() => set("filters")}
          >
            <SlidersHorizontal size={19} />
            {/* The badge counts refinements. The accessible name already names
                them, so the glyph is decorative. */}
            {filtersChip.refinements ? (
              <span className="mobileMapTopbarBadge" aria-hidden="true">{filtersChip.refinements}</span>
            ) : null}
          </IconButton>
          <IconButton aria-label="More map controls" aria-expanded={overlay === "layers"} onClick={() => set("layers")}><Ellipsis size={20} /></IconButton>
        </header>

        {overlay === "search" ? (
          <div className="mobileMapSearchRow">{searchContent}</div>
        ) : null}
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
      {/* Near me failed. The control alone says "Try near me", which names no
          reason and offers no way on, so the reason docks under the one top
          bar, with the area picker one tap away. role="alert" announces it,
          the same as the desktop rail does. */}
      {overlay !== "search" && nearMeError ? (
        <div className="mobileMapNearMeAlert" role="alert">
          <LocateOff size={17} aria-hidden="true" />
          <p className="mobileMapNearMeAlertText">{nearMeError}</p>
          <button
            type="button"
            className="mobileMapNearMeAlertDismiss"
            aria-label="Dismiss the Near me message"
            onClick={onDismissNearMeError}
          >
            <X size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobileMapNearMeAlertArea"
            onClick={() => {
              onDismissNearMeError();
              onOverlayChange("area");
            }}
          >
            Pick an area
          </button>
        </div>
      ) : null}
      {/* The map edge, top to bottom: TfL at the top, Near me at the thumb.
          Near me is a round FAB rather than a bar chip because that is what a
          map reader already knows a locate control looks like, and because the
          bar has no room left at 320px. Its state stays in the accessible
          name ("Near me", "Locating", "Nearby 12", "Try near me"). */}
      {overlay !== "search" ? (
        <MapEdgeControls
          tfl={tflCorner}
          tflOpen={overlay === "tfl"}
          onOpenTfl={() => set("tfl")}
          nearMe={nearMe}
          nearbyCount={nearbyCount}
          onNearMe={onNearMe}
        />
      ) : null}
      {overlay === "none" && !planOpen && !venueListOpen && !bandNoticeOpen ? (
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
      <Sheet kind={sheetKind} title={sheetKind ? MAP_SHEET_TITLES[sheetKind] ?? "Map controls" : "Map controls"} initialSnap={sheetKind === "moment" || sheetKind === "layers" || sheetKind === "near-me" || sheetKind === "area" ? "full" : "half"} onClose={onHome} backLabel={backLabel} onBack={onBack}>{sheetContent}</Sheet>
    </>
  );
}
