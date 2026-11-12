"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { FALLBACK_STYLES, MAP_STYLES, OSM_ATTRIBUTION, STYLE_LOAD_TIMEOUT_MS } from "@/components/map/canvas/tokens";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";
import { venueMapUrl } from "@/lib/venueMapUrl";

maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

export type BeenComparePin = {
  venueId: string;
  name: string;
  side: "both" | "you" | "them";
  lng: number;
  lat: number;
};

const SIDE_WORDS: Record<BeenComparePin["side"], string> = {
  both: "you've both been",
  you: "only you",
  them: "only them",
};

export default function BeenCompareMapCanvas({ pins, onUnavailable }: {
  pins: BeenComparePin[];
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!host.current || !pins.length) return;
    host.current.removeAttribute("data-map-ready");
    const theme = (): "dark" | "light" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    let currentTheme = theme();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: host.current,
        style: MAP_STYLES[currentTheme],
        center: [pins[0]!.lng, pins[0]!.lat],
        zoom: 12,
        pitch: 0,
        bearing: 0,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        scrollZoom: false,
        attributionControl: { compact: true, customAttribution: OSM_ATTRIBUTION },
      });
    } catch {
      onUnavailable();
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    pins.forEach((pin) => bounds.extend([pin.lng, pin.lat]));
    let userMovedCamera = false;
    map.on("movestart", (event) => {
      if (event.originalEvent) userMovedCamera = true;
    });
    const fit = () => map.fitBounds(bounds, { padding: 32, maxZoom: 15, duration: 0 });
    fit();

    const markers = pins.map((pin) => {
      const link = document.createElement("a");
      link.className = `beenComparePin beenComparePin--${pin.side}`;
      link.href = venueMapUrl(pin.venueId);
      link.setAttribute("aria-label", `${pin.name}, ${SIDE_WORDS[pin.side]}. Open it on the map`);
      return new maplibregl.Marker({ element: link, anchor: "center" }).setLngLat([pin.lng, pin.lat]).addTo(map);
    });

    let stopped = false;
    let fallback = false;
    let timer: ReturnType<typeof setTimeout>;
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
    map.on("idle", () => {
      if (stopped || !map.isStyleLoaded()) return;
      clearTimeout(timer);
      if (!host.current?.hasAttribute("data-map-ready")) {
        // The credit opens expanded on a small map and would cover the pins.
        const attribution = host.current?.querySelector(".maplibregl-ctrl-attrib");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.removeAttribute("open");
      }
      host.current?.setAttribute("data-map-ready", "true");
    });
    armTimeout();

    const themeWatch = new MutationObserver(() => {
      if (theme() === currentTheme) return;
      currentTheme = theme();
      fallback = false;
      host.current?.removeAttribute("data-map-ready");
      map.setStyle(MAP_STYLES[currentTheme]);
      armTimeout();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const resize = new ResizeObserver(() => {
      map.resize();
      if (!userMovedCamera) fit();
    });
    resize.observe(host.current);

    return () => {
      stopped = true;
      clearTimeout(timer);
      themeWatch.disconnect();
      resize.disconnect();
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [pins, onUnavailable]);

  return (
    <div className="beenCompareMapFrame">
      <div className="beenCompareMapCanvas maplibreMap" ref={host} role="group" aria-label="Map of both Been lists" />
      <p className="beenCompareMapLoading" role="status">Loading the streets…</p>
    </div>
  );
}
