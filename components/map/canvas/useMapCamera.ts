import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import type { Venue } from "@/lib/venues";
import { LONG_JUMP_CURVE } from "./easing";

type MapView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

type CameraRefs = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  reducedRef: MutableRefObject<boolean>;
  mapViewRef: MutableRefObject<MapView>;
  maxBoundsRef: MutableRefObject<[[number, number], [number, number]]>;
  routeRef: MutableRefObject<Venue[]>;
  venuesRef: MutableRefObject<Venue[]>;
};

// The four camera helpers, extracted verbatim from PubMapCanvas. Each reads live
// refs and keeps EMPTY dep arrays — that is intentional and load-bearing: the
// helpers must always act on the latest map/route/venues without being recreated
// (recreating them would re-fire the arrival/refit effects that consume them).
export function useMapCamera(refs: CameraRefs) {
  const { mapRef, reducedRef, mapViewRef, maxBoundsRef, routeRef, venuesRef } = refs;
  const pendingFrameRef = useRef<number | null>(null);

  // Every camera intent passes through this single lane. A newer intent
  // coalesces a still-pending move and interrupts any active MapLibre
  // animation before it begins, so route, nearby, cluster, and venue moves
  // cannot fight each other on screen.
  const scheduleCamera = useCallback((move: (map: maplibregl.Map) => void) => {
    if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current);
    const run = () => {
      pendingFrameRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      map.stop();
      move(map);
    };
    if (reducedRef.current) run();
    else pendingFrameRef.current = requestAnimationFrame(run);
  }, [mapRef, reducedRef]);

  useEffect(() => () => {
    if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current);
  }, []);

  // Cinematic camera move that suspends the orbit for its duration + resume gap.
  const cinematic = useCallback((options: maplibregl.EaseToOptions) => {
    const duration = reducedRef.current ? 0 : (options.duration ?? 1000);
    scheduleCamera((map) => map.easeTo({ ...options, duration }));
  }, [reducedRef, scheduleCamera]);

  const fitRoute = useCallback(() => {
    const current = routeRef.current;
    if (current.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera((map) => map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
    }));
  }, [reducedRef, routeRef, scheduleCamera]);

  // Fit the active city's bounds (not a city switcher — CitySwitcher owns that).
  const fitCityBounds = useCallback(() => {
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const view = mapViewRef.current;
    // M3: fit-London / city-switch is a "long jump" — fitBounds animates via
    // flyTo by default (linear defaults to false), so `curve` shapes its arc.
    scheduleCamera((map) => map.fitBounds(maxBoundsRef.current, {
      padding: isPhone
        ? { top: 184, right: 24, bottom: 190, left: 24 }
        : 90,
      maxZoom: 11,
      duration: reducedRef.current ? 0 : 800,
      curve: reducedRef.current ? undefined : LONG_JUMP_CURVE,
      pitch: view.pitch,
      bearing: view.bearing,
    }));
  }, [mapViewRef, maxBoundsRef, reducedRef, scheduleCamera]);

  // Borough browse arrival: frame the filtered venue set once (query owns the
  // camera). Skip if the user already tapped a pin — don't fight selectedVenue
  // fly-to. Padding mirrors fitRoute; maxZoom ~13 keeps outer boroughs readable.
  const fitQueryVenues = useCallback(() => {
    const current = venuesRef.current;
    if (current.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera((map) => map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 13,
      duration: reducedRef.current ? 0 : 800,
    }));
  }, [reducedRef, scheduleCamera, venuesRef]);

  const fitNearby = useCallback(
    (location: { lat: number; lng: number }, nearbyVenues: Venue[]) => {
      const bounds = new maplibregl.LngLatBounds([location.lng, location.lat], [
        location.lng,
        location.lat,
      ]);
      nearbyVenues.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
      const isPhone = window.matchMedia("(max-width: 640px)").matches;
      scheduleCamera((map) => map.fitBounds(bounds, {
        padding: isPhone
          ? { top: 190, right: 34, bottom: 190, left: 34 }
          : { top: 150, right: 90, bottom: 110, left: 90 },
        maxZoom: 14.25,
        duration: reducedRef.current ? 0 : 700,
        pitch: isPhone ? 28 : 34,
      }));
    },
    [reducedRef, scheduleCamera],
  );

  return { cinematic, fitRoute, fitCityBounds, fitQueryVenues, fitNearby };
}
