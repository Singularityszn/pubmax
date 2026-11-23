"use client";

import { useEffect, useMemo, useState } from "react";

import type { Landmark } from "@/lib/landmarks";
import { loadPoisFromPath, type Poi } from "@/lib/pois";

import { poisToGeoJSON } from "./geojson";

/**
 * The "pois" source's data, or null until the POIs load. The read waits while
 * the pins hold the secondary streams (lib/mapFirstPinStreams.ts). The city's
 * landmarks load on their own clock, so the twin filter runs again when they
 * arrive. An empty landmark list rebuilt on each render is the same list.
 */
export function usePoisGeoJSON(
  poisPath: string | null | undefined,
  landmarks: readonly Landmark[],
  held: boolean,
): GeoJSON.FeatureCollection | null {
  const [pois, setPois] = useState<Poi[] | null>(null);
  const landmarkKey = landmarks.map((landmark) => landmark.id).join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the key stands for the list.
  const stableLandmarks = useMemo(() => landmarks, [landmarkKey]);

  useEffect(() => {
    if (held) return;
    let cancelled = false;
    loadPoisFromPath(poisPath)
      .then((loaded) => {
        if (!cancelled) setPois(loaded);
      })
      .catch(() => {
        // POIs are ambient garnish: a failed read leaves the pub map intact.
      });
    return () => {
      cancelled = true;
    };
  }, [poisPath, held]);

  return useMemo(() => (pois ? poisToGeoJSON(pois, stableLandmarks) : null), [pois, stableLandmarks]);
}
