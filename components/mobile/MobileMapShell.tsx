"use client";

import Link from "next/link";
import { Ellipsis, LocateFixed, Route, Search, SlidersHorizontal, Sparkles, TrainFront, WalletCards } from "lucide-react";
import { useCallback } from "react";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import type { MapOverlay, MapSheetKind } from "@/lib/mobileShell";

import "./mobileMapShell.css";

const SHEET_TITLES: Partial<Record<MapOverlay, string>> = {
  filters: "Drinks and price",
  tfl: "TfL live",
  tonight: "Tonight",
  layers: "Map layers",
  "pub-pal": "Pub Pal",
  moment: "Choose a pub",
};

const CONTEXTUAL_SHEETS: readonly MapSheetKind[] = [
  "filters",
  "tfl",
  "tonight",
  "layers",
  "pub-pal",
  "moment",
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

export default function MobileMapShell({ cityLabel, overlay, onOverlayChange, onNearMe, nearMeStatus, nearbyCount, tonightCount, tflCount, tflStatus, priceLabel, filtersActive, planOpen, planActive, planStopCount, planInteractive, onPlan, searchContent, filtersContent, tflContent, tonightContent, layersContent, palContent, momentContent }: {
  cityLabel: string;
  overlay: MapOverlay;
  onOverlayChange: (overlay: MapOverlay) => void;
  onNearMe: () => void;
  nearMeStatus: "idle" | "requesting" | "ready" | "error";
  nearbyCount: number;
  tonightCount: number;
  tflCount: number;
  tflStatus: "checking" | "clear" | "issues" | "unavailable";
  priceLabel: string;
  filtersActive: boolean;
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
}) {
  const set = (next: MapOverlay) => onOverlayChange(overlay === next ? "none" : next);
  const closeSheet = useCallback(() => onOverlayChange("none"), [onOverlayChange]);
  const sheetKind = CONTEXTUAL_SHEETS.includes(overlay as MapSheetKind)
    ? (overlay as MapSheetKind)
    : null;
  const sheetContent = sheetKind === "filters" ? filtersContent : sheetKind === "tfl" ? tflContent : sheetKind === "tonight" ? tonightContent : sheetKind === "layers" ? layersContent : sheetKind === "moment" ? momentContent : palContent;

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
            <Chip aria-pressed={nearMeStatus === "ready"} disabled={nearMeStatus === "requesting"} onClick={onNearMe}><LocateFixed size={17} />{nearMeStatus === "requesting" ? "Locating" : nearMeStatus === "ready" ? `Nearby ${nearbyCount}` : nearMeStatus === "error" ? "Try near me" : "Near me"}</Chip>
            <Chip aria-pressed={overlay === "tonight"} onClick={() => set("tonight")}><Sparkles size={17} />Tonight{tonightCount ? <span className="mobileMapChipCount">{tonightCount}</span> : null}</Chip>
            <Chip aria-pressed={overlay === "filters" && filtersActive} onClick={() => set("filters")}><SlidersHorizontal size={17} />Drinks</Chip>
            <Chip aria-pressed={overlay === "filters"} onClick={() => set("filters")}><WalletCards size={17} />{priceLabel}</Chip>
            <Chip aria-pressed={overlay === "tfl"} onClick={() => set("tfl")}><TrainFront size={17} />TfL{tflStatus === "clear" ? " OK" : tflStatus === "unavailable" ? " ?" : null}{tflCount ? <span className="mobileMapChipCount">{tflCount}</span> : null}</Chip>
          </nav>
        )}
      </div>
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
      <Sheet kind={sheetKind} title={sheetKind ? SHEET_TITLES[sheetKind] ?? "Map controls" : "Map controls"} initialSnap={sheetKind === "moment" || sheetKind === "layers" ? "full" : "half"} onClose={closeSheet}>{sheetContent}</Sheet>
    </>
  );
}
