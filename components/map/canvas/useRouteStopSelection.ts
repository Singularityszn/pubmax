"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Map, MapSourceDataEvent } from "maplibre-gl";
import { showRouteStopsAtCamera } from "@/components/map/canvas/routeStopsAtCamera";

export function useRouteStopSelection(ready: boolean, mapRef: RefObject<Map | null>, selectedId?: string) {
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let appliedSource: ReturnType<Map["getSource"]>;
    const apply = () => {
      const source = map.getSource("route-stops");
      if (!source) return;
      if (previous.current && previous.current !== selectedId) {
        map.setFeatureState({ source: "route-stops", id: previous.current }, { selected: false });
      }
      if (selectedId && !map.getFeatureState({ source: "route-stops", id: selectedId }).selected) {
        map.setFeatureState({ source: "route-stops", id: selectedId }, { selected: true });
      }
      previous.current = selectedId;
      appliedSource = source;
    };
    // A shared disc carries the selected stop's id, so the ring lands on it.
    showRouteStopsAtCamera(map, { leadId: selectedId });
    apply();
    const restore = (event: MapSourceDataEvent) => { if (event.sourceId === "route-stops") apply(); };
    const restoreStyle = () => {
      if (map.getSource("route-stops") === appliedSource) return;
      showRouteStopsAtCamera(map);
      apply();
    };
    map.on("styledata", restoreStyle);
    map.on("sourcedata", restore);
    return () => { map.off("styledata", restoreStyle); map.off("sourcedata", restore); };
  }, [mapRef, ready, selectedId]);
}
