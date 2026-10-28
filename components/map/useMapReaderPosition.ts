"use client";

import { useEffect, useRef, useState } from "react";

import { attachMapReaderPositionWatch } from "@/lib/mapReaderPositionWatch";
import { MAP_LOCATION_EXPOSURE_EVENT, mapLocationWasExposed, markMapLocationExposure } from "@/lib/mapLocationExposure";
import type { MapReaderPosition } from "@/lib/mapReaderPosition";

/**
 * Paints the reader's own position on the map (option A). Starts
 * `watchPosition` only when permission is already granted or after an existing
 * map location ask succeeds via {@link latchMapReaderLocationWatch}. Never
 * prompts on its own.
 */
export function useMapReaderPosition(onLocationExposure: () => void): MapReaderPosition | null {
  const [position, setPosition] = useState<MapReaderPosition | null>(null);

  const exposureCallback = useRef(onLocationExposure);
  useEffect(() => { exposureCallback.current = onLocationExposure; }, [onLocationExposure]);
  useEffect(() => {
    const expose = () => exposureCallback.current();
    window.addEventListener(MAP_LOCATION_EXPOSURE_EVENT, expose);
    if (mapLocationWasExposed()) expose();
    const detach = attachMapReaderPositionWatch(setPosition, markMapLocationExposure);
    return () => {
      detach();
      window.removeEventListener(MAP_LOCATION_EXPOSURE_EVENT, expose);
    };
  }, []);

  return position;
}
