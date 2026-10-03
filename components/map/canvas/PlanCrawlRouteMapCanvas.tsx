"use client";

import { useEffect, useRef, type RefObject } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { syncPlanRoutePreviewScene } from "@/components/map/canvas/planRoutePreviewScene";
import {
  MAP_STYLES,
  LONDON_VIEW,
  UK_BOUNDS,
  OSM_ATTRIBUTION,
} from "@/components/map/canvas/tokens";
import { MAPLIBRE_WORKER_URL, maplibregl } from "@/lib/maplibreWorkerAssets";
import type * as MapLibre from "maplibre-gl";
import type { LngLat } from "@/lib/routeMiniMap";
import { planCrawlRouteFitBounds } from "@/lib/planCrawlRouteMap";

maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

const PREVIEW_PITCH = 0;
const PREVIEW_BEARING = 0;

function fitPreviewRoute(map: MapLibre.Map, stopCoords: LngLat[], lineCoords: LngLat[]): void {
  const bounds = planCrawlRouteFitBounds(stopCoords, lineCoords);
  if (!bounds) return;
  const box = new maplibregl.LngLatBounds(
    [bounds.minLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
  );
  const isPhone = window.matchMedia("(max-width: 640px)").matches;
  const padding = isPhone
    ? { top: 36, right: 28, bottom: 36, left: 28 }
    : 52;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  map.fitBounds(box, {
    padding,
    maxZoom: 15,
    duration: reduced ? 0 : 600,
    bearing: PREVIEW_BEARING,
    pitch: PREVIEW_PITCH,
  });
}

export type PlanCrawlRouteMapCanvasProps = {
  stopCoords: LngLat[];
  routeLine: GeoJSON.FeatureCollection;
  routeStops: GeoJSON.FeatureCollection;
  lineCoords: LngLat[];
  attributionSlotRef?: RefObject<HTMLElement | null>;
};

export default function PlanCrawlRouteMapCanvas({
  stopCoords,
  routeLine,
  routeStops,
  lineCoords,
  attributionSlotRef,
}: PlanCrawlRouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibre.Map | null>(null);
  const routeRef = useRef({ stopCoords, routeLine, routeStops, lineCoords });
  const themeRef = useRef<"light" | "dark">(
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: MAP_STYLES[themeRef.current],
      center: LONDON_VIEW.center,
      zoom: LONDON_VIEW.zoom,
      pitch: PREVIEW_PITCH,
      bearing: PREVIEW_BEARING,
      maxBounds: UK_BOUNDS,
      attributionControl: { compact: true, customAttribution: OSM_ATTRIBUTION },
      interactive: false,
    });
    mapRef.current = map;
    const attributionSlot = attributionSlotRef?.current ?? null;
    // MapLibre opens the compact attribution expanded and only collapses it on
    // a drag, which this static preview never gets, so the panel would sit on
    // the last stop. Start it at the (i) button. The button then leaves the
    // aria-hidden canvas so it is not a hidden control inside the card link.
    const parkAttribution = () => {
      const live = container.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
      live?.classList.remove("maplibregl-compact-show");
      live?.removeAttribute("open");
      const liveCorner = container.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");
      if (liveCorner && attributionSlot) attributionSlot.replaceChildren(liveCorner);
      for (const node of container.querySelectorAll<HTMLElement>(
        "button, a, input, select, textarea, canvas, [tabindex]",
      )) {
        node.tabIndex = -1;
      }
    };
    parkAttribution();

    const paintRoute = () => {
      const route = routeRef.current;
      syncPlanRoutePreviewScene(map, route.routeLine, route.routeStops);
      fitPreviewRoute(map, route.stopCoords, route.lineCoords);
      parkAttribution();
    };

    map.on("load", paintRoute);
    if (map.loaded()) paintRoute();

    const onTheme = () => {
      const next = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      if (next === themeRef.current) return;
      themeRef.current = next;
      map.setStyle(MAP_STYLES[next], { diff: false });
      map.once("style.load", paintRoute);
    };
    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      themeObserver.disconnect();
      const parked = attributionSlot?.querySelector(".maplibregl-ctrl-bottom-right");
      if (parked) container.appendChild(parked);
      map.remove();
      mapRef.current = null;
    };
  }, [attributionSlotRef]);

  useEffect(() => {
    routeRef.current = { stopCoords, routeLine, routeStops, lineCoords };
    const map = mapRef.current;
    if (!map || !map.getSource("route-line")) return;
    syncPlanRoutePreviewScene(map, routeLine, routeStops);
    fitPreviewRoute(map, stopCoords, lineCoords);
  }, [stopCoords, routeLine, routeStops, lineCoords]);

  return (
    <div
      ref={containerRef}
      className="planRouteMiniMap__canvas maplibreMap"
      aria-hidden="true"
      data-testid="plan-crawl-route-map"
    />
  );
}
