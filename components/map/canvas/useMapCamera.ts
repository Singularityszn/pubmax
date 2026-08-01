import { useCallback, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import * as maplibregl from "maplibre-gl";
import type { Venue } from "@/lib/venues";
import { LONG_JUMP_CURVE, easeOutCubic } from "./easing";
import { createCameraIntentCoordinator, type CameraIntentKind } from "@/lib/cameraIntent";
import { mapVisibleBand, nearMeCameraFrame, nearestVenueKm } from "@/lib/nearMeMapFrame";

type MapView = { center: [number, number]; zoom: number; pitch: number; bearing: number };

// Chrome the near-me camera must stay clear of. The top values match the map's
// own floating chrome; the bottom values are the fallback when no sheet is open.
const PHONE_TOP_INSET = 190;
const PHONE_BOTTOM_INSET = 190;
const DESKTOP_TOP_INSET = 150;
const DESKTOP_BOTTOM_INSET = 110;

/** The one sheet class that can cover the map on a phone. */
const BOTTOM_SHEET_SELECTOR = ".mobileSharedSheet.open";

// Long enough to read as travel between two places, short enough that the
// answer does not feel withheld. Matches the pub-select fly-to.
const NEAR_ME_CAMERA_DURATION_MS = 700;

/**
 * Top edge of an open bottom sheet, in map-container pixels, or null when no
 * sheet covers the map. Measured because a contextual sheet is content-height:
 * no constant can stand in for it.
 */
function measureBottomSheetTop(containerTop: number): number | null {
  if (typeof document === "undefined") return null;
  const sheet = document.querySelector(BOTTOM_SHEET_SELECTOR);
  if (!sheet) return null;
  const rect = sheet.getBoundingClientRect();
  if (rect.height <= 0) return null;
  return rect.top - containerTop;
}

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

  // Near me puts the READER on the map, not a cloud of pubs. A fitBounds over
  // nearby venues centres the cloud, which drops the reader wherever the
  // geometry leaves them — on a phone, under the near-me sheet. `nearMeCameraFrame`
  // keeps the centre on the reader and lets only zoom and screen offset move.
  const fitNearby = useCallback(
    (location: { lat: number; lng: number }, nearbyVenues: Venue[]) => {
      const map = mapRef.current;
      if (!map) return;
      const isPhone = window.matchMedia("(max-width: 640px)").matches;
      const container = map.getContainer().getBoundingClientRect();
      const viewport = { width: container.width, height: container.height };
      const band = mapVisibleBand({
        height: viewport.height,
        topInset: isPhone ? PHONE_TOP_INSET : DESKTOP_TOP_INSET,
        // Measured, not assumed: the phone sheet is sized by its own content.
        coverTop: measureBottomSheetTop(container.top),
        bottomInset: isPhone ? PHONE_BOTTOM_INSET : DESKTOP_BOTTOM_INSET,
      });
      const frame = nearMeCameraFrame({
        location,
        nearestVenueKm: nearestVenueKm(location, nearbyVenues),
        viewport,
        band,
      });
      const locationKey = `${location.lat.toFixed(4)},${location.lng.toFixed(4)}`;
      scheduleCamera("nearby", `nearby:${locationKey}:${nearbyVenues.map((venue) => venue.id).join(">")}`, (target) => target.easeTo({
        center: frame.center,
        zoom: frame.zoom,
        offset: frame.offset,
        // The move has one job: carry the reader's eye from the city to their
        // own street. Ease-out starts fast, so the arrival reads as an answer
        // rather than a slow pan. Reduced motion takes the same frame instantly.
        duration: reducedRef.current ? 0 : NEAR_ME_CAMERA_DURATION_MS,
        easing: easeOutCubic,
        pitch: isPhone ? 28 : 34,
        // Keep the current rotation (a fit would zero it otherwise).
        bearing: target.getBearing(),
      }));
    },
    [mapRef, reducedRef, scheduleCamera],
  );

  return { cinematic, fitRoute, fitCityBounds, fitQueryVenues, fitNearby };
}
