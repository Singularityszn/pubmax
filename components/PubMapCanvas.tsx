"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import type { Venue } from "@/lib/venues";

type PubMapCanvasProps = {
  venues: Venue[];
  route: Venue[];
  selectedVenueId: string;
  onVenueClick: (id: string) => void;
  onRouteStopClick: (id: string) => void;
  venueSignals?: Map<string, { hasPintDrops: boolean; latestContributorPrice: number | null }>;
};

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const LONDON_VIEW = {
  center: [-0.118, 51.512] as [number, number],
  zoom: 11,
  pitch: 40,
  bearing: -14,
};

const BUCKET_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "bucket"],
  0,
  "#22c07d",
  1,
  "#e2a233",
  2,
  "#e05a44",
  "#64748b",
];

function priceBucket(price: number | null): number {
  if (price === null) return 3;
  if (price <= 5.5) return 0;
  if (price <= 7) return 1;
  return 2;
}

function pubsToGeoJSON(
  venues: Venue[],
  venueSignals: Map<string, { hasPintDrops: boolean; latestContributorPrice: number | null }>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: venues.map((venue) => {
      const signals = venueSignals.get(venue.id);
      return {
        type: "Feature",
        properties: {
          id: venue.id,
          name: venue.name,
          bucket: priceBucket(signals?.latestContributorPrice ?? venue.cheapestPrice),
          story: Boolean(
            venue.curation.heritageNote || venue.curation.writerPick || signals?.hasPintDrops,
          ),
          writer: Boolean(venue.curation.writerPick),
        },
        geometry: { type: "Point", coordinates: [venue.longitude, venue.latitude] },
      };
    }),
  };
}

function routeToLine(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features:
      route.length > 1
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: route.map((venue) => [venue.longitude, venue.latitude]),
              },
            },
          ]
        : [],
  };
}

function routeToStops(route: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: route.map((venue, index) => ({
      type: "Feature",
      properties: { id: venue.id, label: String(index + 1) },
      geometry: { type: "Point", coordinates: [venue.longitude, venue.latitude] },
    })),
  };
}

export default function PubMapCanvas({
  venues,
  route,
  selectedVenueId,
  onVenueClick,
  onRouteStopClick,
  venueSignals = new Map(),
}: PubMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onVenueClickRef = useRef(onVenueClick);
  const onRouteStopClickRef = useRef(onRouteStopClick);

  useEffect(() => {
    onVenueClickRef.current = onVenueClick;
  }, [onVenueClick]);

  useEffect(() => {
    onRouteStopClickRef.current = onRouteStopClick;
  }, [onRouteStopClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      ...LONDON_VIEW,
      maxBounds: [
        [-0.55, 51.28],
        [0.35, 51.72],
      ],
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("pubs", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterRadius: 46,
        clusterMaxZoom: 13,
      });
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "pubs",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "rgba(26, 34, 30, 0.86)",
          "circle-stroke-color": "#3f5648",
          "circle-stroke-width": 1.5,
          "circle-radius": ["step", ["get", "point_count"], 16, 25, 22, 100, 30],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "pubs",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 13,
        },
        paint: { "text-color": "#f4f7f2" },
      });
      map.addLayer({
        id: "pubs-point",
        type: "circle",
        source: "pubs",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": BUCKET_COLOR,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4.5, 15, 7.5],
          "circle-stroke-color": [
            "case",
            ["get", "writer"],
            "#f4c04d",
            ["get", "story"],
            "#5eb3d6",
            "#0b0e0c",
          ],
          "circle-stroke-width": ["case", ["get", "story"], 2, 1],
          "circle-opacity": 0.92,
        },
      });
      map.addLayer({
        id: "pubs-selected",
        type: "circle",
        source: "pubs",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 11,
          "circle-stroke-color": "#f4c04d",
          "circle-stroke-width": 3,
        },
      });

      map.addSource("route-line", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route-line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#f4c04d",
          "line-width": 3.5,
          "line-opacity": 0.85,
          "line-dasharray": [1.5, 1.2],
        },
      });
      map.addSource("route-stops", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-stops",
        type: "circle",
        source: "route-stops",
        paint: {
          "circle-color": "#102820",
          "circle-radius": 13,
          "circle-stroke-color": "#f4c04d",
          "circle-stroke-width": 2.5,
        },
      });
      map.addLayer({
        id: "route-stops-label",
        type: "symbol",
        source: "route-stops",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 13,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#f4f7f2" },
      });

      const clickPub = (event: maplibregl.MapLayerMouseEvent) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onVenueClickRef.current(id);
      };
      const clickRouteStop = (event: maplibregl.MapLayerMouseEvent) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onRouteStopClickRef.current(id);
      };
      map.on("click", "pubs-point", clickPub);
      map.on("click", "route-stops", clickRouteStop);
      map.on("click", "clusters", (event) => {
        const feature = event.features?.[0];
        const clusterId = feature?.properties?.cluster_id;
        const source = map.getSource("pubs") as maplibregl.GeoJSONSource;
        if (clusterId == null || !source) return;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const [lng, lat] = (feature!.geometry as GeoJSON.Point).coordinates;
          map.easeTo({ center: [lng, lat], zoom });
        });
      });
      for (const layer of ["pubs-point", "clusters", "route-stops"]) {
        map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
      }

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("pubs") as maplibregl.GeoJSONSource | undefined)?.setData(
      pubsToGeoJSON(venues, venueSignals),
    );
  }, [venues, venueSignals, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("route-line") as maplibregl.GeoJSONSource | undefined)?.setData(
      routeToLine(route),
    );
    (map.getSource("route-stops") as maplibregl.GeoJSONSource | undefined)?.setData(
      routeToStops(route),
    );
    if (map.getLayer("pubs-selected")) {
      map.setFilter("pubs-selected", ["==", ["get", "id"], selectedVenueId]);
    }
  }, [route, selectedVenueId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || route.length < 2) return;
    const bounds = new maplibregl.LngLatBounds();
    route.forEach((venue) => bounds.extend([venue.longitude, venue.latitude]));
    map.fitBounds(bounds, { padding: 90, maxZoom: 15, duration: 800 });
  }, [route, mapReady]);

  return <div ref={containerRef} className="maplibreMap" />;
}
