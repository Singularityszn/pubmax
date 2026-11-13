"use client";

import { useEffect, useState } from "react";
import type * as maplibregl from "maplibre-gl";

import { UK_BASE_OVERVIEW_SOURCE } from "@/components/map/canvas/ukBaseOverviewLayers";
import {
  loadUkBaseOverview,
  ukBaseOverviewToGeoJSON,
  type UkBaseOverviewPoint,
} from "@/lib/ukBaseOverview";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type Options = {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  applyToMap: (key: string, fn: (map: maplibregl.Map) => void) => void;
  /** Reseeded by buildScene after a theme setStyle wipes every source. */
  dataRef: React.MutableRefObject<GeoJSON.FeatureCollection>;
  minZoom: number;
  held: boolean;
  suspended: boolean;
};

// The base layer's count bubbles below its zoom gate (lib/ukBaseOverview.ts).
// The file is read the first time the camera is below the gate with the
// priced pins already painted, so a London opening at the gate never pays it.
export function useUkBaseOverview({
  mapRef,
  mapReady,
  applyToMap,
  dataRef,
  minZoom,
  held,
  suspended,
}: Options): void {
  const [points, setPoints] = useState<UkBaseOverviewPoint[] | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || held || suspended || points) return;
    let cancelled = false;
    const loadBelowGate = () => {
      if (map.getZoom() >= minZoom) return;
      void loadUkBaseOverview().then((loaded) => {
        if (!cancelled && loaded) setPoints(loaded);
      });
    };
    loadBelowGate();
    map.on("zoomend", loadBelowGate);
    return () => {
      cancelled = true;
      map.off("zoomend", loadBelowGate);
    };
  }, [held, mapReady, mapRef, minZoom, points, suspended]);

  useEffect(() => {
    const data = points && !suspended ? ukBaseOverviewToGeoJSON(points) : EMPTY;
    dataRef.current = data;
    applyToMap("uk-base-overview:data", (map) => {
      (map.getSource(UK_BASE_OVERVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    });
  }, [applyToMap, dataRef, points, suspended]);
}
