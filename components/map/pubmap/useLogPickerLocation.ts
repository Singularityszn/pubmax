import { useCallback, useState } from "react";

import type { LogNearbyOrigin } from "@/lib/mapLogIntent";

export function useLogPickerLocation(active: boolean, userLocation: LogNearbyOrigin | null) {
  const [request, setRequest] = useState<{
    active: boolean;
    userLocation: LogNearbyOrigin | null;
    location: LogNearbyOrigin | null;
  }>({ active, userLocation, location: null });

  if (request.active !== active || request.userLocation !== userLocation) {
    setRequest({ active, userLocation, location: null });
  }

  const setLocation = useCallback((location: LogNearbyOrigin) => {
    setRequest((current) => active && current === request ? { ...current, location } : current);
  }, [active, request]);

  return { location: request.location, setLocation };
}
