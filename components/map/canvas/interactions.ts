import type * as maplibregl from "maplibre-gl";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { lngLatOf } from "@/lib/geo";
import type { Landmark } from "@/lib/landmarks";
import type { PoiCategory } from "@/lib/pois";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { londonVenueIdFromFeature } from "@/lib/londonVenueShards";
import { ukBasePubFromFeature, type UkBasePub } from "@/lib/ukBasePubs";
import { CLUSTER_RIM_LAYERS, LANDMARK_INTERACTION_LAYERS, PUB_FIRST_LAYERS } from "./clickHitPriority";
import { opportunityForFeature } from "./filters";
import { pubHitOf } from "./pubHitPriority";
import { recordPubHitClick } from "./pubHitTrace";
import type { HoveredVenue } from "./types";

type ActivePoi = { name: string; category: PoiCategory };

function clusterHitOf<T>(byLayer: ReadonlyMap<string, T>): T | undefined {
  for (const layer of ["clusters", ...CLUSTER_RIM_LAYERS] as const) {
    const hit = byLayer.get(layer);
    if (hit) return hit;
  }
  return undefined;
}

export { PUB_FIRST_LAYERS };

type ClickDeps = {
  selectLandmark: (landmark: Landmark | null) => void;
  setHoveredVenue: Dispatch<SetStateAction<HoveredVenue | null>>;
  setActivePoi: Dispatch<SetStateAction<ActivePoi | null>>;
  onVenueClickRef: MutableRefObject<(id: string) => void>;
  onUkBasePubClickRef: MutableRefObject<((pub: UkBasePub) => void) | undefined>;
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
    onUkBasePubClickRef,
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

    // The selected layer redraws one pin with a larger hit box. When that box
    // overlaps another visible pin, use the ordinary layer's hit first so a
    // tap resolves to the pin under its point rather than the prior selection.
    const pubHit = pubHitOf(byLayer);
    recordPubHitClick(event.point, features, pubHit);
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

    const clusterHit = clusterHitOf(byLayer);
    if (clusterHit) {
      const clusterId = clusterHit.properties?.cluster_id;
      const source = map.getSource("pubs") as maplibregl.GeoJSONSource;
      if (clusterId == null || !source) return;
      source.getClusterExpansionZoom(clusterId).then((zoom) => {
        const center = lngLatOf((clusterHit.geometry as GeoJSON.Point).coordinates);
        if (center) cinematic({ center, zoom, duration: 700 }, "cluster");
      });
      return;
    }

    // A London venue-layer place opens the same drawer a pub does, by its own
    // `venue-osm-` id; PubMap resolves the id to the cafe's or restaurant's
    // sheet. A feature with no such id answers nothing.
    const openLondonPlace = (id: string | null) => {
      if (!id) return;
      selectLandmark(null);
      setHoveredVenue(null);
      setActivePoi(null);
      onVenueClickRef.current(id);
    };

    // A Shoreditch pilot cafe.
    const cafeHit = byLayer.get("coffee-pilot-point");
    if (cafeHit) return openLondonPlace(londonVenueIdFromFeature(cafeHit));

    const baseHit = byLayer.get("uk-base-point") ?? byLayer.get("uk-base-unnamed-point");
    if (baseHit) {
      const pub = ukBasePubFromFeature(baseHit);
      if (!pub) return;
      selectLandmark(null);
      setHoveredVenue(null);
      setActivePoi(null);
      onUkBasePubClickRef.current?.(pub);
      return;
    }

    // A London restaurant, drawn under the base pubs and so answered after them.
    const restaurantHit = byLayer.get("london-restaurant-point");
    if (restaurantHit) return openLondonPlace(londonVenueIdFromFeature(restaurantHit));

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

    const landmarkHit = LANDMARK_INTERACTION_LAYERS
      .map((layer) => byLayer.get(layer))
      .find(Boolean);
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
  for (const layer of ["pubs-point", "pubs-price-pill", "route-stops"] as const) {
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
  for (const layer of [
    "pubs-point",
    "pubs-price-pill",
    "pubs-point-selected",
    "pubs-price-pill-selected",
  ] as const) {
    map.on("mouseenter", layer, onPubHover);
    map.on("mousemove", layer, onPubHover);
    map.on("mouseleave", layer, () => setHoveredVenue(null));
  }
}

export function wireCursor(map: maplibregl.Map) {
  for (const layer of [
    "pubs-point",
    "pubs-price-pill",
    "pubs-point-selected",
    "pubs-price-pill-selected",
    "clusters",
    ...CLUSTER_RIM_LAYERS,
    "route-stops",
    "tonight-point",
    "coffee-pilot-point",
    "uk-base-point",
    "uk-base-unnamed-point",
    "london-restaurant-point",
    ...LANDMARK_INTERACTION_LAYERS,
    "pois-dot",
    "pois-transport-major",
    "pois-transport-minor",
  ]) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
}
