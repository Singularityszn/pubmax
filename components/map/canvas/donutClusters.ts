import * as maplibregl from "maplibre-gl";
import type { GeoJSONFeature } from "maplibre-gl";
import {
  buildDonutMarkerSvg,
  donutOuterRadius,
  clusterLabelText,
  donutTotal,
  placeClusterCaptions,
  readMinPrice,
  readMinPriceBand,
  type DonutCounts,
} from "@/lib/donutClusterGeometry";
import { CLUSTER_COUNT_BADGE_FILTER, CLUSTER_PRICE_NONE } from "./filters";
import { formatPinPriceLabel } from "./geojson";
import { readTokens } from "./tokens";
import { CLUSTER_FILTER, CLUSTER_MAX_ZOOM } from "./buildScene";

// M5 — DOM cluster discs for the desktop. Once segmented by price band, now
// (owner decision 16 Oct 2026) a NEUTRAL disc: "from" over the cheapest figure
// in that figure's own band ink and "n pubs" under it, the design the GL
// `clusters` / `cluster-count` / `cluster-count-badge` layers draw too.
// `clusterProperties` (wired in buildPubs, buildScene.ts) accumulate the counts
// and `minPrice` / `minPriceKey` directly on the supercluster tree, so no extra
// source or client-side aggregation is needed here — just read them off the
// queried cluster features.
//
// This is the ONE sanctioned DOM-marker exception (MAP_MARKERS_PLAN /
// PRD_MAP_BEAUTY): everything else on the map is a GL layer. The count is
// bounded (DONUT_CAP) precisely so this never turns into an unbounded-DOM
// perf trap — past the cap we fall back to the plain circle+count GL layers
// (buildScene's `clusters` / `cluster-count`), which stay in the style as an
// underlay the whole time and are simply filtered empty/full rather than
// added/removed, so there is never a frame where neither is visible. Their
// visibility belongs to the pin-reveal gate alone: hiding them would leave the
// `pubs` source with no visible layer below PIN_MIN_ZOOM, MapLibre would drop
// its tiles, and the next settled query would find no clusters at all.
const DONUT_CAP = 60;
// Sync runs off the map's own `render`/`moveend`/`sourcedata` events — no new
// RAF loop (Single-RAF rule). `render` still fires every animation frame during
// explicit camera moves, so throttle the expensive querySourceFeatures + diff
// pass rather than run it 60x/sec.
const RENDER_THROTTLE_MS = 120;

// Exported for unit tests — coerces the supercluster's accumulated b0..b3
// per-bucket props into a DonutCounts tuple, guarding a missing / non-numeric /
// non-finite prop down to 0 so a malformed cluster property can never NaN the
// donut geometry.
export function readCounts(props: GeoJSON.GeoJsonProperties): DonutCounts {
  const at = (key: string) => {
    const v = props?.[key];
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  // THE RING COUNTS WHAT THE PINS ARE PAINTED BY. s0..s3 accumulate the Spoons
  // value lens's own band and are all zero while the lens is off, because the
  // property they read is absent then; under the lens EVERY curated pin carries
  // one, so a non-zero s-total is the cluster saying which question its own
  // colours answer. No plumbing: the counts are self-describing.
  const spoons: DonutCounts = [at("s0"), at("s1"), at("s2"), at("s3")];
  if (spoons[0] + spoons[1] + spoons[2] + spoons[3] > 0) return spoons;
  return [at("b0"), at("b1"), at("b2"), at("b3")];
}

// Exported for unit tests — the SVG-rebuild perf guard: markers only re-render
// their donut when this returns false, so position-only updates stay cheap.
export function countsEqual(a: DonutCounts, b: DonutCounts): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

type MarkerEntry = {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  counts: DonutCounts;
  /** The marker's own drawing, so a change of figure or size rebuilds it and
   *  a mere move does not. */
  look: string;
};

// The GL layers a donut stands in for, each with the filter it wears while it
// is showing. The figure comes last on purpose: it is the one a test and a
// reader both treat as "the" cluster layer.
const GL_CLUSTER_LAYERS: ReadonlyArray<readonly [string, maplibregl.FilterSpecification]> = [
  ["clusters-casing", CLUSTER_FILTER],
  ["clusters", CLUSTER_FILTER],
  ["cluster-count-badge", CLUSTER_COUNT_BADGE_FILTER],
  ["cluster-count", CLUSTER_FILTER],
];

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
  cinematic: (options: maplibregl.EaseToOptions, kind?: "cluster" | "venue" | "landmark") => void,
  { enabled = true }: { enabled?: boolean } = {},
): DonutClusterSync {
  // Mobile Safari is especially sensitive to DOM markers being reconciled
  // while vector-source tiles settle. The permanent MapLibre cluster/count
  // layers already carry the same interaction and remain GPU-composited, so
  // mobile/coarse-pointer callers disable this decorative DOM enhancement.
  if (!enabled) return { destroy: () => {} };

  const markers = new Map<number, MarkerEntry>();
  let donutsActive = false;
  let lastRenderAt = 0;

  const setLegacyLayersVisible = (visible: boolean) => {
    for (const [id, filter] of GL_CLUSTER_LAYERS) {
      if (map.getLayer(id)) map.setFilter(id, visible ? filter : false);
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
        cinematic({ center: coordinates, zoom, duration: 700 }, "cluster");
      })
      .catch(() => {
        // A cluster can dissolve between the click and this resolving
        // (rapid zoom/theme swap); nothing to recover from client-side.
      });
  };

  const sync = (emptyIsAuthoritative: boolean) => {
    if (!map.getSource("pubs") || !map.getLayer("clusters")) return;
    // D2 contract: cluster features exist while floor(zoom) <= CLUSTER_MAX_ZOOM
    // (MapLibre serves cluster tiles through the whole 13.x band and dissolves
    // them at CLUSTER_MAX_ZOOM + 1), so keep donuts live for that entire band —
    // markers clear only once no cluster features remain to query.
    if (map.getZoom() >= CLUSTER_MAX_ZOOM + 1) {
      deactivate();
      return;
    }
    let features: GeoJSONFeature[];
    try {
      features = map.querySourceFeatures("pubs", { filter: CLUSTER_FILTER });
    } catch {
      return;
    }
    const byId = new Map<number, GeoJSONFeature>();
    for (const feature of features) {
      const id = feature.properties?.cluster_id;
      if (typeof id === "number" && !byId.has(id)) byId.set(id, feature);
    }
    if (byId.size === 0) {
      // MapLibre 6 can briefly expose an empty querySourceFeatures snapshot
      // between render/source-data passes while the settled viewport still has
      // clusters. Active DOM donuts are already projected by Marker, so retain
      // them until moveend gives us an authoritative empty viewport. Clearing
      // on a transient render hands ownership to the GL underlay; hiding that
      // underlay again on the next non-empty render creates a perpetual swap.
      if (emptyIsAuthoritative) deactivate();
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
    const textColor = dark ? tokens.ink : tokens.inkDeep;
    const casingColor = dark ? tokens.ink : tokens.inkDeep;
    const outerRadius = donutOuterRadius(map.getZoom());
    // Where each disc stands on screen, cheapest first, so the captions are
    // placed by hand the way the GL caption layer places them by collision.
    const onScreen = [...byId].map(([id, feature]) => {
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const point = map.project([lng, lat]);
      const minPrice = readMinPrice(feature.properties, CLUSTER_PRICE_NONE);
      return {
        id,
        x: point.x,
        y: point.y,
        total: donutTotal(readCounts(feature.properties)),
        priced: minPrice !== null,
        order: minPrice ?? Number.POSITIVE_INFINITY,
      };
    });
    onScreen.sort((a, b) => a.order - b.order);
    const captions = placeClusterCaptions(onScreen, outerRadius);
    const markup = (
      counts: DonutCounts,
      figure: string | null,
      figureColor: string,
      countCaption: boolean,
    ) =>
      buildDonutMarkerSvg({
        counts,
        discColor: tokens.panelRaised,
        casingColor,
        // The GL disc's own neutral ring (buildScene `clusters`), so the two
        // renderers draw one design.
        trackColor: tokens.line,
        textColor,
        figureColor,
        outerRadius,
        figure,
        countCaption,
      });
    const seen = new Set<number>();
    for (const [clusterId, feature] of byId) {
      seen.add(clusterId);
      const counts = readCounts(feature.properties);
      // The cheapest price any pub in the disc says, written the way a pin
      // writes one. Under the Spoons value lens no pub carries one, so the disc
      // prints its count, exactly as the GL layer does.
      const minPrice = readMinPrice(feature.properties, CLUSTER_PRICE_NONE);
      const figure = minPrice === null ? null : formatPinPriceLabel(minPrice);
      // The figure wears its OWN pub's band ink, never the crowd's colour.
      const band = figure === null ? null : readMinPriceBand(feature.properties);
      const figureColor = band === null ? textColor : tokens.bandInk[band];
      const countCaption = captions.has(clusterId);
      const look = `${outerRadius}|${figure ?? ""}|${figureColor}|${countCaption}|${textColor}|${casingColor}|${tokens.panelRaised}`;
      const label = `${clusterLabelText(figure, donutTotal(counts))}, tap to zoom in`;
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const existing = markers.get(clusterId);
      if (existing) {
        existing.marker.setLngLat([lng, lat]);
        // Perf guardrail: rebuild the SVG only when this cluster's counts,
        // figure or size actually changed - position updates are cheap
        // setLngLat calls.
        if (!countsEqual(existing.counts, counts) || existing.look !== look) {
          existing.counts = counts;
          existing.look = look;
          existing.el.setAttribute("aria-label", label);
          existing.el.innerHTML = markup(counts, figure, figureColor, countCaption);
        }
        continue;
      }
      const el = document.createElement("div");
      el.className = "donut-cluster-marker";
      el.style.cursor = "pointer";
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", label);
      el.innerHTML = markup(counts, figure, figureColor, countCaption);
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        handleClusterClick(clusterId, [lng, lat]);
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      markers.set(clusterId, { marker, el, counts, look });
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
    sync(false);
  };
  // `sourcedata` fires for every tile/source on the map, including basemap
  // tiles that have nothing to do with the `pubs` cluster tree, so only the
  // app-owned source may drive this reconciliation.
  const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
    if (e.sourceId !== "pubs") return;
    // Every pubs event may expose the first non-empty cluster snapshot, even
    // when it is not authoritative evidence that an empty source is settled.
    // This keeps activation independent from unrelated basemap render churn.
    sync(e.sourceDataType === "content" && e.isSourceLoaded);
  };
  // A theme/style swap (setStyle) recreates the `pubs` source and its
  // supercluster tree — old marker els carry stale-themed SVG and cluster
  // ids that are not guaranteed to survive the rebuild, so drop them and let
  // the next sync repopulate from the fresh style with fresh tokens.
  const onStyleLoad = () => {
    clearMarkers();
    donutsActive = false;
  };
  const onSettledMap = () => sync(true);

  map.on("render", throttledSync);
  map.on("moveend", onSettledMap);
  map.on("idle", onSettledMap);
  map.on("sourcedata", onSourceData);
  map.on("style.load", onStyleLoad);

  return {
    destroy: () => {
      map.off("render", throttledSync);
      map.off("moveend", onSettledMap);
      map.off("idle", onSettledMap);
      map.off("sourcedata", onSourceData);
      map.off("style.load", onStyleLoad);
      clearMarkers();
    },
  };
}
