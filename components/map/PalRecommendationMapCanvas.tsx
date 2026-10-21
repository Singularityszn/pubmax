"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { syncPlanRoutePreviewScene } from "@/components/map/canvas/planRoutePreviewScene";
import { FALLBACK_STYLES, MAP_STYLES, OSM_ATTRIBUTION, STYLE_LOAD_TIMEOUT_MS } from "@/components/map/canvas/tokens";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";
import { palRecommendationPinOffsets, type PalRecommendationPoint } from "@/lib/palRecommendationMap";
import { venueMapUrl } from "@/lib/venueMapUrl";

maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SVG_NS = "http://www.w3.org/2000/svg";

export default function PalRecommendationMapCanvas({ points, onUnavailable }: {
  points: PalRecommendationPoint[];
  onUnavailable: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!host.current || !points.length) return;
    host.current.removeAttribute("data-map-ready");
    let map: maplibregl.Map;
    let stopped = false;
    let fallback = false;
    let timer: ReturnType<typeof setTimeout>;
    const theme = (): "dark" | "light" => document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    let currentTheme = theme();
    try {
      map = new maplibregl.Map({
        container: host.current,
        style: MAP_STYLES[currentTheme],
        center: [points[0]!.lng, points[0]!.lat],
        zoom: 15,
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
    points.forEach((point) => bounds.extend([point.lng, point.lat]));
    const fit = () => map.fitBounds(bounds, { padding: 90, maxZoom: 17, duration: 0 });
    let userMovedCamera = false;
    map.on("movestart", (event) => {
      if (event.originalEvent) userMovedCamera = true;
    });
    // Fit before the first painted frame. The opening view never shows all London.
    fit();

    const pins = points.map((point) => {
      const anchor = document.createElement("div");
      anchor.className = "palChatMapAnchor";
      const stem = document.createElementNS(SVG_NS, "svg");
      stem.setAttribute("viewBox", "-160 -160 320 320");
      stem.setAttribute("aria-hidden", "true");
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("r", "3");
      stem.append(line, dot);
      const link = document.createElement("a");
      link.className = "palChatMapPin";
      link.href = venueMapUrl(point.venueId);
      link.textContent = String(point.number);
      link.setAttribute("aria-label", `Open ${point.name} on the map`);
      link.dataset.venueId = point.venueId;
      anchor.append(stem, link);
      const marker = new maplibregl.Marker({ element: anchor, anchor: "center" }).setLngLat([point.lng, point.lat]).addTo(map);
      return { marker, line, dot, link };
    });
    const positionPins = () => {
      const projected = points.map((point) => map.project([point.lng, point.lat]));
      palRecommendationPinOffsets(projected).forEach((offset, index) => {
        const pin = pins[index]!;
        pin.link.style.left = `${offset.x}px`;
        pin.link.style.top = `${offset.y}px`;
        pin.line.setAttribute("x2", String(offset.x));
        pin.line.setAttribute("y2", String(offset.y));
        pin.dot.style.display = offset.x || offset.y ? "" : "none";
      });
    };
    positionPins();
    map.on("move", positionPins);
    map.on("resize", positionPins);

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
    const onStyle = () => {
      syncPlanRoutePreviewScene(map, EMPTY, EMPTY);
    };
    const onIdle = () => {
      if (stopped || !map.isStyleLoaded() || map.queryRenderedFeatures().length === 0) return;
      clearTimeout(timer);
      if (!host.current?.hasAttribute("data-map-ready")) {
        const attribution = host.current?.querySelector(".maplibregl-ctrl-attrib");
        attribution?.classList.remove("maplibregl-compact-show");
        attribution?.removeAttribute("open");
      }
      host.current?.setAttribute("data-map-ready", "true");
    };
    map.on("style.load", onStyle);
    map.on("idle", onIdle);
    armTimeout();
    const observer = new MutationObserver(() => {
      if (theme() === currentTheme) return;
      currentTheme = theme();
      fallback = false;
      host.current?.removeAttribute("data-map-ready");
      map.setStyle(MAP_STYLES[currentTheme]);
      armTimeout();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const resize = new ResizeObserver(() => {
      map.resize();
      if (!userMovedCamera) fit();
      positionPins();
    });
    resize.observe(host.current);
    return () => {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      resize.disconnect();
      pins.forEach((pin) => pin.marker.remove());
      map.remove();
    };
  }, [points, onUnavailable]);

  return <div className="palChatMapFrame"><div className="palChatMapCanvas maplibreMap" ref={host} role="group" aria-label="Map of the recommended pubs" /><p className="palChatMapLoading" role="status">Loading the streets…</p></div>;
}
