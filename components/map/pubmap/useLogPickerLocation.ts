import { useCallback, useEffect, useRef, useState } from "react";

import type { LogNearbyOrigin } from "@/lib/mapLogIntent";

export function useLogPickerLocation(active: boolean, userLocation: LogNearbyOrigin | null) {
  const [request, setRequest] = useState<{
    active: boolean;
    userLocation: LogNearbyOrigin | null;
    location: LogNearbyOrigin | null;
    locating: boolean;
  }>({ active, userLocation, location: null, locating: active });

  if (request.active !== active || request.userLocation !== userLocation) {
    setRequest({ active, userLocation, location: null, locating: active });
  }

  const requestVersion = useRef(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const version = ++requestVersion.current;
    const settle = () => {
      if (!cancelled && requestVersion.current === version) setRequest((current) => current.active && current.userLocation === userLocation ? { ...current, locating: false } : current);
    };
    const locate = () => {
      if (cancelled) return;
      if (!navigator.geolocation) { settle(); return; }
      navigator.geolocation.getCurrentPosition((position) => {
        if (cancelled || requestVersion.current !== version) return;
        setRequest((current) => current.active && current.userLocation === userLocation
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
  }, [active, userLocation]);

  const setLocation = useCallback((location: LogNearbyOrigin) => {
    requestVersion.current += 1;
    setRequest((current) => active && current === request ? { ...current, location, locating: false } : current);
  }, [active, request]);

  return { location: request.location, locating: request.locating, setLocation };
}
