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
 * Publishes whether the reader's dot falls on the rendered canvas, re-read
 * when the camera settles or the canvas resizes. A new fix at the same place
 * publishes nothing, and only a dot that is gone publishes "no answer".
 */
export function useReaderOnCanvas(
  mapRef: RefObject<maplibregl.Map | null>,
  mapReady: boolean,
  position: { lat: number; lng: number } | null,
): void {
  const lat = position?.lat ?? null;
  const lng = position?.lng ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || lat === null || lng === null) {
      publishMapReaderOnCanvas(null);
      return;
    }
    const read = () => publishMapReaderOnCanvas(readerOnCanvas(map, lat, lng));
    read();
    // A touch tilt or turn can end with no moveend.
    const settled = ["moveend", "pitchend", "rotateend", "resize"] as const;
    for (const event of settled) map.on(event, read);
    return () => {
      for (const event of settled) map.off(event, read);
    };
  }, [mapRef, mapReady, lat, lng]);
  useEffect(() => () => publishMapReaderOnCanvas(null), []);
}
