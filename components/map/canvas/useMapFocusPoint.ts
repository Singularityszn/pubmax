"use client";

import { useEffect, type RefObject } from "react";

import {
  cameraIntentForFocusSource,
  mapCameraFocusKey,
  mapCameraFocusMoves,
  type MapCameraFocus,
} from "@/lib/mapCameraFocus";
import type { useMapCamera } from "./useMapCamera";
import { walkSurfaceOffset, whenWalkPanelSettles } from "./useMapCamera";

export function useMapFocusPoint(
  mapReady: boolean,
  focusPoint: MapCameraFocus | null | undefined,
  focusKeyRef: RefObject<string | null>,
  cinematic: ReturnType<typeof useMapCamera>["cinematic"],
) {
  useEffect(() => {
    if (!mapReady || !focusPoint) return;
    if (!mapCameraFocusMoves(focusPoint, focusKeyRef.current)) return;
    const move = () => {
      focusKeyRef.current = mapCameraFocusKey(focusPoint);
      cinematic(
        { center: focusPoint.center, zoom: focusPoint.zoom, duration: 900,
          ...(focusPoint.source === "landmark" ? { offset: walkSurfaceOffset() ?? [0, 0] } : {}) },
        cameraIntentForFocusSource(focusPoint.source),
        focusPoint.source === "opening-location" ? "automatic" : "user",
        focusPoint.source !== "opening-location" ? focusPoint.token : 0,
      );
    };
    if (focusPoint.source === "landmark") return whenWalkPanelSettles(move);
    move();
  }, [mapReady, focusPoint, focusKeyRef, cinematic]);
}
