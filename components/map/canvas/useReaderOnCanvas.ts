import { useEffect, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";

import { publishMapReaderOnCanvas } from "@/lib/mapReaderOnCanvas";

/**
 * Publishes whether the reader's dot falls on the rendered canvas. Coordinate
 * projection only, re-read when the camera settles or the canvas resizes.
 */
export function useReaderOnCanvas(
  mapRef: RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  position: { lat: number; lng: number } | null,
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !position) return;
    const read = () => {
      const point = map.project([position.lng, position.lat]);
      const canvas = map.getContainer();
      publishMapReaderOnCanvas(
        point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight,
      );
    };
    read();
    map.on("moveend", read);
    map.on("resize", read);
    return () => {
      map.off("moveend", read);
      map.off("resize", read);
      publishMapReaderOnCanvas(null);
    };
  }, [mapRef, mapReady, position]);
}
