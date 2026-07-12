import maplibregl, { type GeoJSONFeature } from "maplibre-gl";
import { buildDonutMarkerSvg, donutTotal, type DonutCounts } from "@/lib/donutClusterGeometry";
import { readTokens } from "./tokens";
import { PIN_UNCLUSTER_ZOOM } from "./buildScene";

// M5 — donut cluster markers segmented by price band. `clusterProperties`
// (wired in buildPubs, buildScene.ts) accumulate per-bucket counts (b0..b3 —
// same priceBucket() order the legend/pin fill already use: ≤£5.50 / >£5.50–
// ≤£7 / >£7 / no price) directly on the supercluster tree, so no extra
// source or client-side aggregation is needed here — just read them off the
// queried cluster features.
//
// This is the ONE sanctioned DOM-marker exception (MAP_MARKERS_PLAN /
// PRD_MAP_BEAUTY): everything else on the map is a GL layer. The count is
// bounded (DONUT_CAP) precisely so this never turns into an unbounded-DOM
// perf trap — past the cap we fall back to the plain circle+count GL layers
// (buildScene's `clusters` / `cluster-count`), which stay in the style as an
// underlay the whole time and are simply toggled visible/none rather than
// added/removed, so there is never a frame where neither is visible.
const DONUT_CAP = 60;
// Sync runs off the map's own `render`/`moveend`/`sourcedata` events — no new
// RAF loop (Single-RAF rule) — but `render` fires every animation frame
// during the idle-orbit bearing sweep, so throttle the expensive
// querySourceFeatures + diff pass rather than run it 60x/sec.
const RENDER_THROTTLE_MS = 120;

const BUCKET_COLOR_KEYS = ["pint", "amber", "brick", "muted"] as const;

function readCounts(props: GeoJSON.GeoJsonProperties): DonutCounts {
  const at = (key: string) => {
    const v = props?.[key];
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return [at("b0"), at("b1"), at("b2"), at("b3")];
}

function countsEqual(a: DonutCounts, b: DonutCounts): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

type MarkerEntry = {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  counts: DonutCounts;
};

export type DonutClusterSync = {
  /** Detach every listener + marker. Safe to call once, from the same
   *  cleanup path that tears down the rest of the map instance. */
  destroy: () => void;
};

/** Wires donut-marker sync for the clustered `pubs` source. Reuses the exact
 *  cluster-expansion-zoom click behaviour the plain `clusters` circle layer
 *  already has (interactions.ts) so clicking a donut zooms in identically to
 *  clicking the bubble it replaced. */
export function createDonutClusterSync(
  map: maplibregl.Map,
  cinematic: (options: maplibregl.EaseToOptions) => void,
): DonutClusterSync {
  const markers = new Map<number, MarkerEntry>();
  let donutsActive = false;
  let lastRenderAt = 0;

  const setLegacyLayersVisible = (visible: boolean) => {
    const visibility: "visible" | "none" = visible ? "visible" : "none";
    for (const id of ["clusters", "cluster-count"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
    }
  };

  const clearMarkers = () => {
    for (const entry of markers.values()) entry.marker.remove();
    markers.clear();
  };

  const deactivate = () => {
    if (markers.size > 0) clearMarkers();
    if (donutsActive) {
      donutsActive = false;
      setLegacyLayersVisible(true);
    }
  };

  const handleClusterClick = (clusterId: number, coordinates: [number, number]) => {
    const source = map.getSource("pubs") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source
      .getClusterExpansionZoom(clusterId)
      .then((zoom) => {
        cinematic({ center: coordinates, zoom, duration: 700 });
      })
      .catch(() => {
        // A cluster can dissolve between the click and this resolving
        // (rapid zoom/theme swap); nothing to recover from client-side.
      });
  };

  const sync = () => {
    if (!map.getSource("pubs") || !map.getLayer("clusters")) return;
    // D2 contract: clusters only exist strictly below PIN_UNCLUSTER_ZOOM
    // (clusterMaxZoom = PIN_UNCLUSTER_ZOOM - 1). At/above the boundary there
    // are no cluster features to query, so markers clear and the handoff to
    // individual pins is unaffected by this module.
    if (map.getZoom() >= PIN_UNCLUSTER_ZOOM) {
      deactivate();
      return;
    }
    let features: GeoJSONFeature[];
    try {
      features = map.querySourceFeatures("pubs", { filter: ["has", "point_count"] });
    } catch {
      return;
    }
    const byId = new Map<number, GeoJSONFeature>();
    for (const feature of features) {
      const id = feature.properties?.cluster_id;
      if (typeof id === "number" && !byId.has(id)) byId.set(id, feature);
    }
    if (byId.size === 0) {
      deactivate();
      return;
    }
    if (byId.size > DONUT_CAP) {
      // Bounded-count guardrail: fall back to the GL circle layers rather
      // than create/manage more than DONUT_CAP live Marker instances.
      deactivate();
      return;
    }
    if (!donutsActive) {
      donutsActive = true;
      setLegacyLayersVisible(false);
    }
    const tokens = readTokens();
    const dark = document.documentElement.dataset.theme === "dark";
    const colors = BUCKET_COLOR_KEYS.map((key) => tokens[key]);
    const textColor = dark ? tokens.ink : tokens.inkDeep;
    const seen = new Set<number>();
    for (const [clusterId, feature] of byId) {
      seen.add(clusterId);
      const counts = readCounts(feature.properties);
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const existing = markers.get(clusterId);
      if (existing) {
        existing.marker.setLngLat([lng, lat]);
        // Perf guardrail: rebuild the SVG only when this cluster's counts
        // actually changed — position updates are cheap setLngLat calls.
        if (!countsEqual(existing.counts, counts)) {
          existing.counts = counts;
          existing.el.innerHTML = buildDonutMarkerSvg({
            counts,
            colors,
            ringColor: tokens.panelRaised,
            textColor,
          });
        }
        continue;
      }
      const el = document.createElement("div");
      el.className = "donut-cluster-marker";
      el.style.cursor = "pointer";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${donutTotal(counts)} pubs, tap to zoom in`);
      el.innerHTML = buildDonutMarkerSvg({
        counts,
        colors,
        ringColor: tokens.panelRaised,
        textColor,
      });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        handleClusterClick(clusterId, [lng, lat]);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      markers.set(clusterId, { marker, el, counts });
    }
    for (const [id, entry] of markers) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
  };

  const throttledSync = () => {
    const now = performance.now();
    if (now - lastRenderAt < RENDER_THROTTLE_MS) return;
    lastRenderAt = now;
    sync();
  };
  // `sourcedata` fires for every tile/source on the map, including basemap
  // tiles that have nothing to do with the `pubs` cluster tree — gate on the
  // event actually being our source finishing a load, and route through the
  // same throttle as `render` so a burst of tile loads can't re-run the
  // querySourceFeatures + marker diff pass more than ~8x/sec.
  const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
    if (e.sourceId !== "pubs" || !e.isSourceLoaded) return;
    throttledSync();
  };
  // A theme/style swap (setStyle) recreates the `pubs` source and its
  // supercluster tree — old marker els carry stale-themed SVG and cluster
  // ids that are not guaranteed to survive the rebuild, so drop them and let
  // the next sync repopulate from the fresh style with fresh tokens.
  const onStyleLoad = () => {
    clearMarkers();
    donutsActive = false;
  };

  map.on("render", throttledSync);
  map.on("moveend", sync);
  map.on("sourcedata", onSourceData);
  map.on("style.load", onStyleLoad);

  return {
    destroy: () => {
      map.off("render", throttledSync);
      map.off("moveend", sync);
      map.off("sourcedata", onSourceData);
      map.off("style.load", onStyleLoad);
      clearMarkers();
    },
  };
}
