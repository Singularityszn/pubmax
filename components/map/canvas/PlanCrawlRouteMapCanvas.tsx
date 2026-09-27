"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { syncPlanRoutePreviewScene } from "@/components/map/canvas/planRoutePreviewScene";
import {
  MAP_STYLES,
  LONDON_VIEW,
  UK_BOUNDS,
  OSM_ATTRIBUTION,
} from "@/components/map/canvas/tokens";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";
import type { LngLat } from "@/lib/routeMiniMap";
import { planCrawlRouteFitBounds } from "@/lib/planCrawlRouteMap";

maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

const PREVIEW_PITCH = 0;
const PREVIEW_BEARING = 0;

function fitPreviewRoute(map: maplibregl.Map, stopCoords: LngLat[], lineCoords: LngLat[]): void {
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
};

export default function PlanCrawlRouteMapCanvas({
  stopCoords,
  routeLine,
  routeStops,
  lineCoords,
}: PlanCrawlRouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const routeRef = useRef<PlanCrawlRouteMapCanvasProps>({ stopCoords, routeLine, routeStops, lineCoords });
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
    // MapLibre opens the compact attribution expanded and only collapses it on
    // a drag, which this static preview never gets, so the panel would sit on
    // the last stop. Start it at the (i) button. Not a synthetic click: the
    // preview sits inside the card's clickable figure and the click would
    // navigate to the map.
    const attribution = container.querySelector<HTMLElement>(".maplibregl-ctrl-attrib");
    attribution?.classList.remove("maplibregl-compact-show");
    attribution?.removeAttribute("open");

    const paintRoute = () => {
      const route = routeRef.current;
      syncPlanRoutePreviewScene(map, route.routeLine, route.routeStops);
      fitPreviewRoute(map, route.stopCoords, route.lineCoords);
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
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
