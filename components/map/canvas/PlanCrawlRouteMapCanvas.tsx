"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { syncPlanRoutePreviewScene } from "@/components/map/canvas/planRoutePreviewScene";
import { followMapPixelRatio, mapPixelRatio } from "@/components/map/canvas/webgl";
import {
  MAP_STYLES,
  LONDON_VIEW,
  UK_BOUNDS,
  OSM_ATTRIBUTION,
} from "@/components/map/canvas/tokens";
import { MAPLIBRE_WORKER_URL } from "@/lib/maplibreWorkerAssets";
import type { LngLat } from "@/lib/routeMiniMap";
import { planCrawlRouteFitBounds } from "@/lib/planCrawlRouteMap";
import { mergeCrowdedRouteStops } from "@/lib/routeStopDiscs";
import { easeInOutCubic, partialRouteLine, ROUTE_DRAW_MS } from "@/lib/routeDraw";

maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

const PREVIEW_PITCH = 0;
const PREVIEW_BEARING = 0;

type PreviewRoute = { stopCoords: LngLat[]; routeStops: GeoJSON.FeatureCollection; lineCoords: LngLat[] };

/**
 * Fits the route into the card, and returns the stops as they read at the zoom
 * it lands on: stops too close to part at that zoom share one disc.
 */
function fitPreviewRoute(map: maplibregl.Map, route: PreviewRoute): GeoJSON.FeatureCollection {
  const bounds = planCrawlRouteFitBounds(route.stopCoords, route.lineCoords);
  if (!bounds) return route.routeStops;
  const box = new maplibregl.LngLatBounds(
    [bounds.minLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
  );
  const isPhone = window.matchMedia("(max-width: 640px)").matches;
  const padding = isPhone
    ? { top: 36, right: 28, bottom: 36, left: 28 }
    : 52;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const camera = { padding, maxZoom: 18, bearing: PREVIEW_BEARING, pitch: PREVIEW_PITCH };
  map.fitBounds(box, { ...camera, duration: reduced ? 0 : 600 });
  return mergeCrowdedRouteStops(route.routeStops, map.cameraForBounds(box, camera)?.zoom ?? map.getZoom());
}

/**
 * Routes already drawn in this tab, keyed by their pubs in arrival order. A
 * route draws itself ONCE: a strip that remounts, a theme swap or a new key on
 * the same map must not replay the draw for a route the reader has already
 * watched arrive.
 */
const drawnRouteKeys = new Set<string>();

export type PlanCrawlRouteMapCanvasProps = {
  /** The arrived route's pubs in order. Same key, never drawn twice. */
  drawKey?: string;
  stopCoords: LngLat[];
  routeLine: GeoJSON.FeatureCollection;
  routeStops: GeoJSON.FeatureCollection;
  lineCoords: LngLat[];
  attributionSlotRef?: RefObject<HTMLElement | null>;
};

export default function PlanCrawlRouteMapCanvas({
  drawKey,
  stopCoords,
  routeLine,
  routeStops,
  lineCoords,
  attributionSlotRef,
}: PlanCrawlRouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const routeRef = useRef({ stopCoords, routeLine, routeStops, lineCoords });
  const stopsRef = useRef(routeStops);
  const drawKeyRef = useRef(drawKey);
  const drawingRef = useRef(false);
  const drawRef = useRef<() => void>(() => {});
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
      pixelRatio: mapPixelRatio(),
      attributionControl: { compact: true, customAttribution: OSM_ATTRIBUTION },
      interactive: false,
    });
    mapRef.current = map;
    const stopFollowingPixelRatio = followMapPixelRatio(map);
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

    // The draw owns the line source while it runs; a routed line that lands
    // mid-draw is picked up by the next frame through `routeRef`, and the last
    // frame is always the whole line.
    let drawFrame = 0;
    const drawRouteOnce = () => {
      const key = drawKeyRef.current;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!key || reduced || drawnRouteKeys.has(key)) return false;
      drawnRouteKeys.add(key);
      cancelAnimationFrame(drawFrame);
      drawingRef.current = true;
      // The scene was just built with the whole line. Take it back before the
      // first frame so the finished route never flashes ahead of its own draw.
      (map.getSource("route-line") as maplibregl.GeoJSONSource | undefined)
        ?.setData(partialRouteLine(routeRef.current.routeLine, 0));
      const started = performance.now();
      const step = (now: number) => {
        const source = map.getSource("route-line") as maplibregl.GeoJSONSource | undefined;
        if (!source) {
          drawingRef.current = false;
          return;
        }
        const progress = (now - started) / ROUTE_DRAW_MS;
        if (progress >= 1) {
          drawingRef.current = false;
          syncPlanRoutePreviewScene(map, routeRef.current.routeLine, stopsRef.current);
          return;
        }
        source.setData(partialRouteLine(routeRef.current.routeLine, easeInOutCubic(progress)));
        drawFrame = requestAnimationFrame(step);
      };
      drawFrame = requestAnimationFrame(step);
      return true;
    };

    const paintRoute = () => {
      const route = routeRef.current;
      stopsRef.current = fitPreviewRoute(map, route);
      syncPlanRoutePreviewScene(map, route.routeLine, stopsRef.current);
      parkAttribution();
      drawRouteOnce();
    };

    const fitResizedPreview = () => {
      const stopsSource = map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined;
      if (!stopsSource) return;
      stopsRef.current = fitPreviewRoute(map, routeRef.current);
      stopsSource.setData(stopsRef.current);
    };
    map.on("resize", fitResizedPreview);

    map.on("load", paintRoute);
    if (map.loaded()) paintRoute();
    drawRef.current = () => {
      if (map.getSource("route-line")) drawRouteOnce();
    };

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
      drawRef.current = () => {};
      cancelAnimationFrame(drawFrame);
      drawingRef.current = false;
      map.off("resize", fitResizedPreview);
      themeObserver.disconnect();
      stopFollowingPixelRatio();
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
    stopsRef.current = fitPreviewRoute(map, routeRef.current);
    // Mid-draw, the animation's next frame reads the new line from `routeRef`.
    if (!drawingRef.current) syncPlanRoutePreviewScene(map, routeLine, stopsRef.current);
  }, [stopCoords, routeLine, routeStops, lineCoords]);

  useEffect(() => {
    drawKeyRef.current = drawKey;
    drawRef.current();
  }, [drawKey]);

  return (
    <div
      ref={containerRef}
      className="planRouteMiniMap__canvas maplibreMap"
      aria-hidden="true"
      data-testid="plan-crawl-route-map"
    />
  );
}
