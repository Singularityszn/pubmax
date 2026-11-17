"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Map, MapSourceDataEvent } from "maplibre-gl";

export function useRouteStopSelection(ready: boolean, mapRef: RefObject<Map | null>, selectedId?: string) {
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const apply = () => {
      if (!map.getSource("route-stops")) return;
      if (previous.current && previous.current !== selectedId) {
        map.setFeatureState({ source: "route-stops", id: previous.current }, { selected: false });
      }
      if (selectedId && !map.getFeatureState({ source: "route-stops", id: selectedId }).selected) {
        map.setFeatureState({ source: "route-stops", id: selectedId }, { selected: true });
      }
      previous.current = selectedId;
    };
    apply();
    const restore = (event: MapSourceDataEvent) => { if (event.sourceId === "route-stops") apply(); };
    map.on("sourcedata", restore);
    return () => { map.off("sourcedata", restore); };
  }, [mapRef, ready, selectedId]);
}
