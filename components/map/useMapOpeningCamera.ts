"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { MapCameraFocus } from "@/lib/mapCameraFocus";

export function useMapOpeningCamera({
  shouldResolveOpeningLocation,
  openingLocationResolved,
  openingLocationCancelledRef,
  locationFirstMapView,
  cancelOpeningLocation,
}: {
  shouldResolveOpeningLocation: boolean;
  openingLocationResolved: boolean;
  openingLocationCancelledRef: RefObject<boolean>;
  locationFirstMapView: { center: [number, number]; zoom: number };
  cancelOpeningLocation: () => void;
}) {
  const [mapCameraTouched, setMapCameraTouched] = useState(false);
  const mapCameraTouchedRef = useRef(false);
  const [openingLocationFocus, setOpeningLocationFocus] = useState<MapCameraFocus | null>(null);

  const claimMapCamera = useCallback(() => {
    mapCameraTouchedRef.current = true;
    setMapCameraTouched(true);
    cancelOpeningLocation();
    setOpeningLocationFocus(null);
  }, [cancelOpeningLocation]);

  useEffect(() => {
    if (
      !shouldResolveOpeningLocation ||
      !openingLocationResolved ||
      openingLocationCancelledRef.current ||
      mapCameraTouchedRef.current
    ) return;
    const viewport = locationFirstMapView;
    setOpeningLocationFocus((current) => {
      if (
        current?.center[0] === viewport.center[0] &&
        current.center[1] === viewport.center[1] &&
        current.zoom === viewport.zoom
      ) return current;
      return {
        center: viewport.center,
        zoom: viewport.zoom,
        source: "opening-location",
        token: (current?.token ?? 0) + 1,
      };
    });
  }, [locationFirstMapView, openingLocationResolved, shouldResolveOpeningLocation, openingLocationCancelledRef]);

  return { mapCameraTouched, mapCameraTouchedRef, openingLocationFocus, claimMapCamera };
}
