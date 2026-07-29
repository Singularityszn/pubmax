import { useCallback, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import type { Venue } from "@/lib/venues";
import { LONG_JUMP_CURVE } from "./easing";
import { createCameraIntentCoordinator, type CameraIntentKind } from "@/lib/cameraIntent";

type MapView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

type CameraRefs = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  reducedRef: MutableRefObject<boolean>;
  mapViewRef: MutableRefObject<MapView>;
  cityBoundsRef: MutableRefObject<[[number, number], [number, number]]>;
  routeRef: MutableRefObject<Venue[]>;
  venuesRef: MutableRefObject<Venue[]>;
};

// The four camera helpers, extracted verbatim from PubMapCanvas. Each reads live
// refs and keeps EMPTY dep arrays — that is intentional and load-bearing: the
// helpers must always act on the latest map/route/venues without being recreated
// (recreating them would re-fire the arrival/refit effects that consume them).
export function useMapCamera(refs: CameraRefs) {
  const { mapRef, reducedRef, mapViewRef, cityBoundsRef, routeRef, venuesRef } = refs;
  const coordinator = useMemo(() => createCameraIntentCoordinator({
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    onRun: (kind, sequence) => {
      performance.mark(`pubmax:camera-intent:${kind}`);
      window.dispatchEvent(new CustomEvent("pubmax:camera-intent", {
        detail: { kind, sequence },
      }));
    },
  }), []);

  // Every camera intent passes through this single lane. A newer intent
  // coalesces a still-pending move and interrupts any active MapLibre
  // animation before it begins, so route, nearby, cluster, and venue moves
  // cannot fight each other on screen.
  const scheduleCamera = useCallback((kind: CameraIntentKind, key: string, move: (map: maplibregl.Map) => void) => {
    const run = () => {
      const map = mapRef.current;
      if (!map) return;
      map.stop();
      move(map);
    };
    coordinator.schedule(kind, key, run);
  }, [coordinator, mapRef]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  // Explicit camera move for venue, route, and city navigation.
  const cinematic = useCallback((options: maplibregl.EaseToOptions, kind: CameraIntentKind = "venue") => {
    const duration = reducedRef.current ? 0 : (options.duration ?? 1000);
    const center = Array.isArray(options.center)
      ? options.center.join(",")
      : options.center && "lng" in options.center
        ? `${options.center.lng},${options.center.lat}`
        : "current";
    scheduleCamera(kind, `${kind}:${center}:${options.zoom ?? "current"}:${options.pitch ?? "current"}`, (map) => map.easeTo({ ...options, duration }));
  }, [reducedRef, scheduleCamera]);

  const fitRoute = useCallback(() => {
    const current = routeRef.current;
    if (current.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera("route", `route:${current.map((venue) => venue.id).join(">")}`, (map) => map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
      // fitBounds defaults bearing to 0, silently flattening a rotated map on
      // every route fit (and the flat camera then persists via the session
      // snapshot). Preserve the user's current rotation instead.
      bearing: map.getBearing(),
    }));
  }, [reducedRef, routeRef, scheduleCamera]);

  // Fit the active city's bounds (not a city switcher — CitySwitcher owns that).
  const fitCityBounds = useCallback(() => {
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const view = mapViewRef.current;
    // M3: fit-London / city-switch is a "long jump" — fitBounds animates via
    // flyTo by default (linear defaults to false), so `curve` shapes its arc.
    scheduleCamera("city", `city:${cityBoundsRef.current.flat().join(",")}`, (map) => map.fitBounds(cityBoundsRef.current, {
      padding: isPhone
        ? { top: 184, right: 24, bottom: 190, left: 24 }
        : 90,
      maxZoom: 11,
      duration: reducedRef.current ? 0 : 800,
      curve: reducedRef.current ? undefined : LONG_JUMP_CURVE,
      pitch: view.pitch,
      bearing: view.bearing,
    }));
  }, [cityBoundsRef, mapViewRef, reducedRef, scheduleCamera]);

  // Borough browse arrival: frame the filtered venue set once (query owns the
  // camera). Skip if the user already tapped a pin — don't fight selectedVenue
  // fly-to. Padding mirrors fitRoute; maxZoom ~13 keeps outer boroughs readable.
  const fitQueryVenues = useCallback(() => {
    const current = venuesRef.current;
    if (current.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    scheduleCamera("query", `query:${current.map((venue) => venue.id).join(">")}`, (map) => map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 13,
      duration: reducedRef.current ? 0 : 800,
      // Same flattening trap as fitRoute: keep the current rotation.
      bearing: map.getBearing(),
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
      const locationKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
      scheduleCamera("nearby", `nearby:${locationKey}:${nearbyVenues.map((venue) => venue.id).join(">")}`, (map) => map.fitBounds(bounds, {
        padding: isPhone
          ? { top: 190, right: 34, bottom: 190, left: 34 }
          : { top: 150, right: 90, bottom: 110, left: 90 },
        maxZoom: 14.25,
        duration: reducedRef.current ? 0 : 700,
        pitch: isPhone ? 28 : 34,
        // Keep the current rotation (fitBounds would zero it otherwise).
        bearing: map.getBearing(),
      }));
    },
    [reducedRef, scheduleCamera],
  );

  return { cinematic, fitRoute, fitCityBounds, fitQueryVenues, fitNearby };
}
