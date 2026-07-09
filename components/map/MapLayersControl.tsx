"use client";

// Corner Layers control for the mobile map. Keeps Tube/Parks/story bands out of
// the mid-map strip; opens a compact popover above the tab bar.

import { Layers, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  POI_TOGGLE_GROUPS,
  isPoiGroupOn,
  togglePoiGroup,
  type PoiToggleGroup,
} from "@/lib/poiToggleGroups";
import type { PoiCategory } from "@/lib/pois";
import { STORY_BANDS } from "@/lib/storyBands";

import "./mapLayersControl.css";

type MapLayersControlProps = {
  poiHidden: Record<PoiCategory, boolean>;
  onPoiHiddenChange: (next: Record<PoiCategory, boolean>) => void;
  activeBandId?: string;
  onBandChange?: (bandId: string) => void;
};

export default function MapLayersControl({
  poiHidden,
  onPoiHiddenChange,
  activeBandId = "",
  onBandChange,
}: MapLayersControlProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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
    window.addEventListener("touchstart", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("touchstart", onPointer);
    };
  }, [open]);

  function toggleGroup(group: PoiToggleGroup) {
    onPoiHiddenChange(togglePoiGroup(poiHidden, group));
  }

  const anyLayerOn = POI_TOGGLE_GROUPS.some((group) => isPoiGroupOn(poiHidden, group));
  const storiesActive = Boolean(activeBandId);

  return (
    <div className="mapLayersControl" ref={rootRef}>
      <button
        type="button"
        className={
          open || anyLayerOn || storiesActive
            ? "mapLayersFab isActive"
            : "mapLayersFab"
        }
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close map layers" : "Open map layers"}
        onClick={() => setOpen((value) => !value)}
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
              onClick={() => setOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <p className="mapLayersHint">Optional place markers — off by default on phones.</p>

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
                {STORY_BANDS.map((band) => {
                  const on = activeBandId === band.id;
                  return (
                    <button
                      key={band.id}
                      type="button"
                      className={on ? "mapLayersChip isOn" : "mapLayersChip"}
                      aria-pressed={on}
                      title={band.copy}
                      onClick={() => onBandChange(on ? "" : band.id)}
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
