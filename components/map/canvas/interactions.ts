import type maplibregl from "maplibre-gl";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Landmark } from "@/lib/landmarks";
import type { PoiCategory } from "@/lib/pois";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { opportunityForFeature } from "./filters";
import type { HoveredVenue } from "./types";

type ActivePoi = { name: string; category: PoiCategory };

// Pub-first hit testing: a single map click queries pubs/route stops before
// landmarks/POIs so dense central London taps open a pub sheet, not a
// landmark card that happened to sit under the same finger.
export const PUB_FIRST_LAYERS = [
  "pubs-point-selected",
  "pubs-point",
  "route-stops",
  "tonight-point",
  "clusters",
  "landmarks-icon",
  "pois-dot",
  "pois-transport-major",
  "pois-transport-minor",
] as const;

type ClickDeps = {
  selectLandmark: (landmark: Landmark | null) => void;
  setHoveredVenue: Dispatch<SetStateAction<HoveredVenue | null>>;
  setActivePoi: Dispatch<SetStateAction<ActivePoi | null>>;
  onVenueClickRef: MutableRefObject<(id: string) => void>;
  onRouteStopClickRef: MutableRefObject<(id: string) => void>;
  onTonightOpportunityClickRef: MutableRefObject<((op: ThingsToDoOpportunity) => void) | undefined>;
  cityLandmarksRef: MutableRefObject<Landmark[]>;
  tonightOpportunitiesRef: MutableRefObject<ThingsToDoOpportunity[]>;
  cinematic: (options: maplibregl.EaseToOptions, kind?: "cluster" | "venue" | "landmark") => void;
};

export function wireClickRouting(map: maplibregl.Map, deps: ClickDeps) {
  const {
    selectLandmark,
    setHoveredVenue,
    setActivePoi,
    onVenueClickRef,
    onRouteStopClickRef,
    onTonightOpportunityClickRef,
    cityLandmarksRef,
    tonightOpportunitiesRef,
    cinematic,
  } = deps;
  map.on("click", (event) => {
    const features = map.queryRenderedFeatures(event.point, {
      layers: PUB_FIRST_LAYERS.filter((id) => Boolean(map.getLayer(id))),
    });
    if (!features.length) return;

    const byLayer = new Map<string, (typeof features)[number]>();
    for (const feature of features) {
      const layerId = feature.layer?.id;
      if (typeof layerId === "string" && !byLayer.has(layerId)) {
        byLayer.set(layerId, feature);
      }
    }

    const pubHit = byLayer.get("pubs-point-selected") ?? byLayer.get("pubs-point");
    if (pubHit) {
      const id = pubHit.properties?.id;
      if (typeof id !== "string") return;
      selectLandmark(null);
      setHoveredVenue(null);
      setActivePoi(null);
      onVenueClickRef.current(id);
      return;
    }

    const stopHit = byLayer.get("route-stops");
    if (stopHit) {
      const id = stopHit.properties?.id;
      if (typeof id !== "string") return;
      selectLandmark(null);
      setActivePoi(null);
      onRouteStopClickRef.current(id);
      return;
    }

    const clusterHit = byLayer.get("clusters");
    if (clusterHit) {
      const clusterId = clusterHit.properties?.cluster_id;
      const source = map.getSource("pubs") as maplibregl.GeoJSONSource;
      if (clusterId == null || !source) return;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const [lng, lat] = (clusterHit.geometry as GeoJSON.Point).coordinates;
        cinematic({ center: [lng, lat], zoom, duration: 700 }, "cluster");
      });
      return;
    }

    const tonightHit = byLayer.get("tonight-point");
    if (tonightHit) {
      const opportunity = opportunityForFeature(
        tonightHit.properties as GeoJSON.GeoJsonProperties | undefined,
        tonightOpportunitiesRef.current,
      );
      if (!opportunity) return;
      selectLandmark(null);
      setHoveredVenue(null);
      setActivePoi(null);
      onTonightOpportunityClickRef.current?.(opportunity);
      return;
    }

    const landmarkHit = byLayer.get("landmarks-icon");
    if (landmarkHit) {
      const id = landmarkHit.properties?.id;
      const landmark = cityLandmarksRef.current.find((item) => item.id === id);
      if (!landmark) return;
      setActivePoi(null);
      selectLandmark(landmark);
      cinematic({
        center: landmark.coordinates,
        zoom: Math.max(map.getZoom(), 13),
        pitch: 55,
        duration: 1100,
      }, "landmark");
      return;
    }

    for (const layer of ["pois-dot", "pois-transport-major", "pois-transport-minor"] as const) {
      const poiHit = byLayer.get(layer);
      if (!poiHit) continue;
      const name = poiHit.properties?.name;
      const category = poiHit.properties?.category;
      if (typeof name !== "string" || typeof category !== "string") return;
      selectLandmark(null);
      setActivePoi({ name, category: category as PoiCategory });
      return;
    }
  });
}

export function wireHoverPrefetch(
  map: maplibregl.Map,
  { onVenuePrefetchRef }: { onVenuePrefetchRef: MutableRefObject<((id: string) => void) | undefined> },
) {
  // Press-start / hover intent warms venue detail so the sheet opens warm.
  // Also wire route-stops — those pins are the same venue ids.
  const prefetchFromEvent = (event: {
    features?: Array<{ properties?: Record<string, unknown> | null }> | undefined;
  }) => {
    const id = event.features?.[0]?.properties?.id;
    if (typeof id !== "string") return;
    onVenuePrefetchRef.current?.(id);
  };
  for (const layer of ["pubs-point", "route-stops"] as const) {
    map.on("mouseenter", layer, prefetchFromEvent);
    map.on("mousedown", layer, prefetchFromEvent);
    map.on("touchstart", layer, prefetchFromEvent);
  }
}

export function wirePubHover(
  map: maplibregl.Map,
  {
    hoverCapableRef,
    setHoveredVenue,
  }: {
    hoverCapableRef: MutableRefObject<boolean>;
    setHoveredVenue: Dispatch<SetStateAction<HoveredVenue | null>>;
  },
) {
  const onPubHover = (event: maplibregl.MapLayerMouseEvent) => {
    if (!hoverCapableRef.current) return;
    const props = event.features?.[0]?.properties;
    const id = props?.id;
    const name = props?.name;
    if (typeof id !== "string" || typeof name !== "string") return;
    setHoveredVenue({ id, name, x: event.point.x, y: event.point.y });
  };
  for (const layer of ["pubs-point", "pubs-point-selected"] as const) {
    map.on("mouseenter", layer, onPubHover);
    map.on("mousemove", layer, onPubHover);
    map.on("mouseleave", layer, () => setHoveredVenue(null));
  }
}

export function wireCursor(map: maplibregl.Map) {
  for (const layer of [
    "pubs-point",
    "pubs-point-selected",
    "clusters",
    "route-stops",
    "tonight-point",
    "landmarks-icon",
    "pois-dot",
    "pois-transport-major",
    "pois-transport-minor",
  ]) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
}
