import { useCallback } from "react";
import type { MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import type { Venue } from "@/lib/venues";
import { ORBIT_RESUME_MS } from "./tokens";
import { LONG_JUMP_CURVE } from "./easing";

type MapView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

type CameraRefs = {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  holdUntilRef: MutableRefObject<number>;
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
  const { mapRef, holdUntilRef, reducedRef, mapViewRef, maxBoundsRef, routeRef, venuesRef } = refs;

  // Cinematic camera move that suspends the orbit for its duration + resume gap.
  const cinematic = useCallback((options: maplibregl.EaseToOptions) => {
    const map = mapRef.current;
    if (!map) return;
    const duration = reducedRef.current ? 0 : (options.duration ?? 1000);
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + duration + ORBIT_RESUME_MS,
    );
    map.easeTo({ ...options, duration });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- empty deps intentional: reads live refs
  }, []);

  const fitRoute = useCallback(() => {
    const map = mapRef.current;
    const current = routeRef.current;
    if (!map || current.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + 900 + ORBIT_RESUME_MS,
    );
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 15,
      duration: reducedRef.current ? 0 : 800,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- empty deps intentional: reads live refs
  }, []);

  // Fit the active city's bounds (not a city switcher — CitySwitcher owns that).
  const fitCityBounds = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + 900 + ORBIT_RESUME_MS,
    );
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    const view = mapViewRef.current;
    // M3: fit-London / city-switch is a "long jump" — fitBounds animates via
    // flyTo by default (linear defaults to false), so `curve` shapes its arc.
    map.fitBounds(maxBoundsRef.current, {
      padding: isPhone
        ? { top: 184, right: 24, bottom: 190, left: 24 }
        : 90,
      maxZoom: 11,
      duration: reducedRef.current ? 0 : 800,
      curve: reducedRef.current ? undefined : LONG_JUMP_CURVE,
      pitch: view.pitch,
      bearing: view.bearing,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- empty deps intentional: reads live refs
  }, []);

  // Borough browse arrival: frame the filtered venue set once (query owns the
  // camera). Skip if the user already tapped a pin — don't fight selectedVenue
  // fly-to. Padding mirrors fitRoute; maxZoom ~13 keeps outer boroughs readable.
  const fitQueryVenues = useCallback(() => {
    const map = mapRef.current;
    const current = venuesRef.current;
    if (!map || current.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    current.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    holdUntilRef.current = Math.max(
      holdUntilRef.current,
      performance.now() + 900 + ORBIT_RESUME_MS,
    );
    const isPhone = window.matchMedia("(max-width: 640px)").matches;
    map.fitBounds(bounds, {
      padding: isPhone
        ? { top: 160, right: 28, bottom: 200, left: 28 }
        : 90,
      maxZoom: 13,
      duration: reducedRef.current ? 0 : 800,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- empty deps intentional: reads live refs
  }, []);

  return { cinematic, fitRoute, fitCityBounds, fitQueryVenues };
}
