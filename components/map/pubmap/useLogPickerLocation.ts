import { useCallback, useEffect, useState } from "react";

import type { LogNearbyOrigin } from "@/lib/mapLogIntent";
import { markMapLocationExposure } from "@/lib/mapLocationExposure";

export function useLogPickerLocation(active: boolean, userLocation: LogNearbyOrigin | null) {
  const [request, setRequest] = useState<{
    lifetime: object;
    active: boolean;
    userLocation: LogNearbyOrigin | null;
    location: LogNearbyOrigin | null;
    locating: boolean;
  }>({ lifetime: {}, active, userLocation, location: null, locating: active });

  if (request.active !== active || request.userLocation !== userLocation) {
    setRequest({ lifetime: {}, active, userLocation, location: null, locating: active });
  }

  const { lifetime } = request;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setRequest((current) => current.lifetime === lifetime && current.locating ? { ...current, locating: false } : current);
    };
    const locate = () => {
      if (cancelled) return;
      if (!navigator.geolocation) { settle(); return; }
      markMapLocationExposure();
      navigator.geolocation.getCurrentPosition((position) => {
        if (cancelled) return;
        setRequest((current) => current.lifetime === lifetime && current.locating
          ? { ...current, location: { lat: position.coords.latitude, lng: position.coords.longitude }, locating: false }
          : current);
      }, settle, { enableHighAccuracy: false, timeout: 5000, maximumAge: 60_000 });
    };
    if (!navigator.permissions?.query) locate();
    else void navigator.permissions.query({ name: "geolocation" }).then((permission) => {
      if (permission.state === "granted") locate();
      else settle();
    }).catch(locate);
    return () => { cancelled = true; };
  }, [active, userLocation, lifetime]);

  const setLocation = useCallback((location: LogNearbyOrigin) => {
    setRequest((current) => active && current.lifetime === lifetime ? { ...current, location, locating: false } : current);
  }, [active, lifetime]);

  return { location: request.location, locating: request.locating, setLocation };
}
