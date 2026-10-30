"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { FALLBACK_STYLES, MAP_STYLES, OSM_ATTRIBUTION, STYLE_LOAD_TIMEOUT_MS } from "@/components/map/canvas/tokens";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";
import type { TimeMachineVenue } from "@/lib/priceTimeMachine";

// The time machine's own small map. It is NOT the main map: it shares the
// basemap styles, the attribution and the worker module with
// components/PubMapCanvas.tsx and nothing else, the way
// components/map/PalRecommendationMapCanvas.tsx does.
//
// Every pub in the history file the index can place carries one pin for the
// life of the map. A year change only relights them: a pin with a dated
// record in that year prints its recorded price, and every other pin is grey
// with no figure. The pins are aria-hidden because the list under the map is
// the same answer in reading order, with a link on each pub.

maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

export default function TimeMachineMapCanvas({
  venues,
  lit,
  onUnavailable,
}: {
  venues: TimeMachineVenue[];
  /** venueId to the price its pin prints this year. Absent is grey. */
  lit: Record<string, string>;
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const pins = useRef<Map<string, HTMLDivElement>>(new Map());
  const litRef = useRef(lit);

  useEffect(() => {
    if (!host.current || venues.length === 0) return;
    const container = host.current;
    container.removeAttribute("data-map-ready");
    let map: maplibregl.Map;
    let stopped = false;
    let fallback = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const theme = (): "dark" | "light" =>
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    let currentTheme = theme();
    const bounds = new maplibregl.LngLatBounds();
    venues.forEach((venue) => bounds.extend([venue.lng, venue.lat]));
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLES[currentTheme],
        bounds,
        fitBoundsOptions: { padding: 32, maxZoom: 14 },
        pitch: 0,
        bearing: 0,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        scrollZoom: false,
        dragRotate: false,
        attributionControl: { compact: true, customAttribution: OSM_ATTRIBUTION },
      });
    } catch {
      onUnavailable();
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const markers = venues.map((venue) => {
      const pin = document.createElement("div");
      pin.className = "tmPin";
      pin.setAttribute("aria-hidden", "true");
      pin.dataset.venueId = venue.venueId;
      pin.title = venue.name;
      paintPin(pin, litRef.current[venue.venueId]);
      pins.current.set(venue.venueId, pin);
      return new maplibregl.Marker({ element: pin, anchor: "center" })
        .setLngLat([venue.lng, venue.lat])
        .addTo(map);
    });

    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (stopped) return;
        if (!fallback) {
          fallback = true;
          map.setStyle(FALLBACK_STYLES[currentTheme]);
          armTimeout();
        } else onUnavailable();
      }, STYLE_LOAD_TIMEOUT_MS);
    };
    const onIdle = () => {
      if (stopped || !map.isStyleLoaded()) return;
      clearTimeout(timer);
      if (!container.hasAttribute("data-map-ready")) {
        // The compact credit opens itself on a narrow map and covers the
        // pins; fold it once, the way the Pal's map does. It stays one tap away.
        const attribution = container.querySelector(".maplibregl-ctrl-attrib");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.removeAttribute("open");
      }
      container.setAttribute("data-map-ready", "true");
    };
    map.on("idle", onIdle);
    map.on("error", () => {
      // A tile or style error is the timeout's to judge; nothing here throws.
    });
    armTimeout();

    const observer = new MutationObserver(() => {
      if (theme() === currentTheme) return;
      currentTheme = theme();
      fallback = false;
      container.removeAttribute("data-map-ready");
      map.setStyle(MAP_STYLES[currentTheme]);
      armTimeout();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);
    const pinMap = pins.current;

    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      resize.disconnect();
      markers.forEach((marker) => marker.remove());
      pinMap.clear();
      map.remove();
    };
  }, [venues, onUnavailable]);

  useEffect(() => {
    litRef.current = lit;
    for (const [venueId, pin] of pins.current) paintPin(pin, lit[venueId]);
  }, [lit]);

  return (
    <div className="tmMapFrame">
      <div
        className="tmMapCanvas maplibreMap"
        ref={host}
        role="group"
        aria-label="Map of London pubs in the price history. The list below gives each lit pub."
      />
      <p className="tmMapLoading" role="status">
        Loading the streets…
      </p>
    </div>
  );
}

/** A lit pin prints its recorded price; a grey pin prints nothing at all. */
function paintPin(pin: HTMLDivElement, price: string | undefined): void {
  if (price) {
    pin.dataset.lit = "true";
    pin.textContent = price;
  } else {
    pin.dataset.lit = "false";
    pin.textContent = "";
  }
}
