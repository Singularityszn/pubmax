"use client";

import { useCallback, useEffect, useState } from "react";

import type { CityId } from "@/lib/cities";
import { createMapCameraOwnership } from "@/lib/mapCameraProvenance";
import { mapLocationWasExposed } from "@/lib/mapLocationExposure";
import { retireMapOpeningLocation } from "@/lib/mapOpeningLocation";
import { clearMapResumeCamera, type MapResumeSnapshot } from "@/lib/mapResume";
import { clearMobileMapSessionCamera, type MobileMapSessionV1 } from "@/lib/mobileShell";
import { shouldResolveOpeningLocation as shouldResolveOpeningLocationFor } from "@/lib/pubMap";

export function usePrivateMapCamera({
  cityId,
  mapResumeSeed,
  restoredMobileSession,
  needsOpeningResolution,
}: {
  cityId: CityId;
  mapResumeSeed: MapResumeSnapshot | null;
  restoredMobileSession: MobileMapSessionV1 | null;
  needsOpeningResolution: boolean;
}) {
  useEffect(() => { retireMapOpeningLocation(); }, []);

  const shouldResolveOpeningLocation = shouldResolveOpeningLocationFor({
    needsOpeningResolution,
    mapResumeSeed: mapResumeSeed?.viewport ? mapResumeSeed : null,
    restoredMobileSession,
  });
  const [cameraOwnership] = useState(() => {
    const ownership = createMapCameraOwnership(mapResumeSeed?.viewport ? mapResumeSeed : restoredMobileSession);
    if (mapLocationWasExposed()) ownership.exposeLocation();
    return ownership;
  });
  useEffect(() => {
    cameraOwnership.attach();
    return () => cameraOwnership.detach();
  }, [cameraOwnership]);
  const invalidatePrivateCamera = useCallback(() => {
    cameraOwnership.exposeLocation();
    clearMobileMapSessionCamera();
    clearMapResumeCamera(cityId);
  }, [cameraOwnership, cityId]);

  return { cameraOwnership, invalidatePrivateCamera, shouldResolveOpeningLocation };
}
