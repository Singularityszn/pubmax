"use client";

import { useCallback, useState } from "react";
import { nextCameraRequestToken } from "@/lib/cameraIntent";
import type { CuratedWalk } from "@/lib/curatedWalk";
import type { MapCameraFocus } from "@/lib/mapCameraFocus";
import type { MapSurfaceRetirement } from "@/lib/mapSurfaceState";

export function useCuratedWalkFocus(
  walk: CuratedWalk | undefined,
  selectVenue: (id: string) => void,
  setFocus: (focus: MapCameraFocus) => void,
  setSheetSnap: (snap: "half") => void,
  retireMapSurfaces: (surfaces: readonly MapSurfaceRetirement[]) => void,
) {
  const [selection, setSelection] = useState({ walk, id: "", token: 0 });
  const selectRouteStop = useCallback((id: string) => {
    const stop = walk?.stops.find((entry) => entry.id === id);
    if (!stop) return selectVenue(id);
    retireMapSurfaces(["venue"]);
    const token = nextCameraRequestToken();
    setSelection({ walk, id, token });
    setFocus({ center: [stop.longitude, stop.latitude], zoom: 16, source: "landmark", token });
    setSheetSnap("half");
  }, [walk, selectVenue, setFocus, setSheetSnap, retireMapSurfaces]);
  return { selectRouteStop, selectedWalkStopId: selection.walk === walk ? selection.id : "", selectedWalkStopToken: selection.walk === walk ? selection.token : 0 };
}
