import { useEffect, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";

import { publishMapReaderOnCanvas } from "@/lib/mapReaderOnCanvas";

type ProjectingMap = Pick<maplibregl.Map, "project" | "getContainer">;

/** Whether a point projects inside the map's rendered container. Coordinate projection only. */
export function readerOnCanvas(map: ProjectingMap, lat: number, lng: number): boolean {
  const point = map.project([lng, lat]);
  const canvas = map.getContainer();
  return point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight;
}

/**
 * Publishes how the rendered canvas judges a point, again each time the camera
 * settles or the canvas resizes. A reader asks it about the fix it renders
 * with, so a new fix is never judged by the answer for the one before.
 */
export function useReaderOnCanvas(mapRef: RefObject<maplibregl.Map | null>, mapReady: boolean): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) {
      publishMapReaderOnCanvas(null);
      return;
    }
    const read = () => publishMapReaderOnCanvas((lat, lng) => readerOnCanvas(map, lat, lng));
    read();
    // A touch tilt or turn can end with no moveend.
    const settled = ["moveend", "pitchend", "rotateend", "resize"] as const;
    for (const event of settled) map.on(event, read);
    return () => {
      for (const event of settled) map.off(event, read);
      publishMapReaderOnCanvas(null);
    };
  }, [mapRef, mapReady]);
}
