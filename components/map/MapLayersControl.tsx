"use client";

// Corner Layers control — all viewports (Wave J declutter). Keeps Tube/Parks/
// story bands out of the mid-map strip; opens a compact popover.

import { Layers, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  POI_TOGGLE_GROUPS,
  isPoiGroupOn,
  togglePoiGroup,
  type PoiToggleGroup,
} from "@/lib/poiToggleGroups";
import type { PoiCategory } from "@/lib/pois";
import { STORY_BANDS, type StoryBand } from "@/lib/storyBands";

import "./mapLayersControl.css";

type MapLayersControlProps = {
  poiHidden: Record<PoiCategory, boolean>;
  onPoiHiddenChange: (next: Record<PoiCategory, boolean>) => void;
  activeBandId?: string;
  onBandChange?: (bandId: string) => void;
  /** City Place-story corridors; defaults to London STORY_BANDS. */
  storyBands?: StoryBand[];
};

export default function MapLayersControl({
  poiHidden,
  onPoiHiddenChange,
  activeBandId = "",
  onBandChange,
  storyBands = STORY_BANDS,
}: MapLayersControlProps) {
  // Deep-link `?band=` opens Layers without an effect: bandForcesOpen until the
  // user dismisses for that band id (Wave J removed mid-map band picker).
  const [manualOpen, setManualOpen] = useState(false);
  const [closedForBandId, setClosedForBandId] = useState<string | null>(null);
  const bandForcesOpen = Boolean(activeBandId) && closedForBandId !== activeBandId;
  const open = manualOpen || bandForcesOpen;
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  function closePanel() {
    setManualOpen(false);
    if (activeBandId) setClosedForBandId(activeBandId);
  }

  function openPanel() {
    setManualOpen(true);
    setClosedForBandId(null);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    function onPointer(event: MouseEvent | TouchEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (event.target instanceof Node && !root.contains(event.target)) {
        closePanel();
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
    // closePanel closes over activeBandId; rebind when open/band changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional close capture
  }, [open, activeBandId]);

  function toggleGroup(group: PoiToggleGroup) {
    onPoiHiddenChange(togglePoiGroup(poiHidden, group));
  }

  const storiesActive = Boolean(activeBandId);

  return (
    <div className="mapLayersControl" ref={rootRef}>
      <button
        type="button"
        className={
          open || storiesActive ? "mapLayersFab isActive" : "mapLayersFab"
        }
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          open
            ? "Close map layers"
            : "Map layers — transit, parks, and place stories"
        }
        title="Transit, parks & place stories"
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <Layers size={18} aria-hidden="true" />
        <span>Layers</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="mapLayersPanel"
          role="dialog"
          aria-label="Map layers"
        >
          <div className="mapLayersPanelHead">
            <strong>Map layers</strong>
            <button
              type="button"
              className="mapLayersClose"
              aria-label="Close layers"
              onClick={closePanel}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <p className="mapLayersHint">
            Transit, parks, and story corridors — opt in when you need them.
          </p>

          <div className="mapLayersGroup" role="group" aria-label="Points of interest">
            {POI_TOGGLE_GROUPS.map((group) => {
              const on = isPoiGroupOn(poiHidden, group);
              return (
                <button
                  key={group.id}
                  type="button"
                  className={on ? "mapLayersChip isOn" : "mapLayersChip"}
                  aria-pressed={on}
                  onClick={() => toggleGroup(group)}
                >
                  <span className="mapLayersSwatch" style={{ background: group.color }} />
                  {group.label}
                </button>
              );
            })}
          </div>

          {onBandChange ? (
            <div className="mapLayersStories" role="group" aria-label="Place stories">
              <p className="mapLayersSectionLabel">Place stories</p>
              <div className="mapLayersBandRow">
                {storyBands.map((band) => {
                  const on = activeBandId === band.id;
                  return (
                    <button
                      key={band.id}
                      type="button"
                      className={on ? "mapLayersChip isOn" : "mapLayersChip"}
                      aria-pressed={on}
                      title={band.copy}
                      onClick={() => {
                        setClosedForBandId(null);
                        onBandChange(on ? "" : band.id);
                      }}
                    >
                      {band.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
