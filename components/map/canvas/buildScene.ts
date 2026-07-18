import type maplibregl from "maplibre-gl";
import {
  applyBasemapTaste,
  applySelectionMute,
  clusterCircleColorExpr,
  buildingMassingColorExpr,
} from "@/lib/mapBasemapTaste";
import { isTransitNetworkVisible } from "@/lib/poiToggleGroups";
import { TRANSPORT_CATEGORIES, type PoiCategory } from "@/lib/pois";
import type { IconTokens } from "@/lib/mapIcons";
import {
  type Tokens,
  withAlpha,
  DASH_SEQ,
  registerMapIcons,
  GLOW_BASE_STROKE_OPACITY,
  GLOW_BASE_STROKE_WIDTH,
} from "./tokens";
import {
  AMBIENT_CATEGORIES,
  poiFilter,
  transportFilter,
  TRANSPORT_ICON_MATCH,
  TUBE_LINE_OFFSET_EXPR,
  pubIconOpacityExpr,
  PIN_ICON_SIZE_EXPR,
} from "./filters";

// Single source of truth for the cluster/uncluster boundary: the zoom at which
// individual pins take over. The unclustered per-pub layers use it directly as
// their `minzoom` floor; the pubs source clusters strictly BELOW it
// (clusterMaxZoom = PIN_UNCLUSTER_ZOOM - 1, because MapLibre renders clusters
// up to AND INCLUDING clusterMaxZoom — an equal value would draw cluster discs
// and singleton pins together across the 12.x band). Isolated pubs sit outside
// any cluster radius, so without the minzoom floor they paint as individual
// pins at every zoom in BOTH themes ("pin soup" at city zoom); the dark
// basemap just masked it. One constant, one clean handoff: below it, clusters
// only; at/above it, clusters dissolve and pins appear together.
export const PIN_UNCLUSTER_ZOOM = 12;

export type SceneCtx = {
  map: maplibregl.Map;
  tokens: Tokens;
  dark: boolean;
  textFont: string[];
  addLayerOnce: (...args: Parameters<maplibregl.Map["addLayer"]>) => void;
  poiHidden: Record<PoiCategory, boolean>;
  transitLinesPath: string | null;
  showLandmarks: boolean;
  landmarksGeoJSON: GeoJSON.FeatureCollection;
  poisData: GeoJSON.FeatureCollection;
  routeLine: GeoJSON.FeatureCollection;
  routeStops: GeoJSON.FeatureCollection;
  bandCorridor: GeoJSON.FeatureCollection;
  bandColor: string;
  bandMemberIds: string[];
  pubsData: GeoJSON.FeatureCollection;
  tonightData: GeoJSON.FeatureCollection;
  tonightVisible: boolean;
  selectedId: string;
  /** M2 — caller-owned store of pre-mute paint originals (layerId::prop → value)
   *  for the POI-at-initiation selection mute. Survives across builds via a ref;
   *  cleared + re-applied here on every style.load. */
  selectionMuteStore: Map<string, unknown>;
};

// Wave J1 — warm paper/river/brass washes on the stock basemap before we add
// pub layers, so Liberty/Positron stop reading as generic grey GIS.
export function applySceneTaste(ctx: SceneCtx) {
  const { map, tokens, dark } = ctx;
  applyBasemapTaste(
    map,
    {
      paper: tokens.paper,
      panelRaised: tokens.panelRaised,
      ink: tokens.ink,
      inkDeep: tokens.inkDeep,
      line: tokens.line,
      muted: tokens.muted,
      pint: tokens.pint,
      amber: tokens.amber,
      brass: tokens.brass,
      river: tokens.river,
      riverBright: tokens.riverBright,
      buildingEmissive: tokens.buildingEmissive,
      parkTint: tokens.parkTint,
    },
    dark,
  );
}

export function buildSkyAndBuildings(ctx: SceneCtx) {
  const { map, tokens, dark, addLayerOnce } = ctx;
  // --- Sky + fog: M4 signature dusk/night gradient — deep indigo zenith
  // fading to a warm brass horizon band in dark mode (setSky); light mode
  // keeps its existing quiet pale-sky → paper fade (skyZenith/skyHorizon
  // resolve to riverBright/paper there — see globals.css). Both themes
  // driven purely by tokens, re-applied on every style.load + theme switch
  // (same call site as applyBasemapTaste, before M2's selection-mute
  // snapshot in applySelectionState — see assembleScene ordering).
  map.setSky({
    "sky-color": tokens.skyZenith,
    "horizon-color": dark ? withAlpha(tokens.skyHorizon, 0.55) : tokens.skyHorizon,
    "fog-color": dark ? tokens.inkDeep : tokens.paper,
    "sky-horizon-blend": 0.7,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 12, 0.2],
  });

  // --- 3-D buildings, extruded from the basemap's own building layer so
  // the City and Canary Wharf read as skyline when you fly in. If the style
  // already ships its own extrusion (OpenFreeMap Liberty has `building-3d`),
  // use that rather than stacking a second layer on top of it.
  const styleLayers = map.getStyle().layers;
  const firstSymbolId = styleLayers.find((layer) => layer.type === "symbol")?.id;
  const hasExtrusion = styleLayers.some((layer) => layer.type === "fill-extrusion");
  const buildingLayer = styleLayers.find(
    (layer) =>
      layer.type === "fill" &&
      "source-layer" in layer &&
      layer["source-layer"] === "building",
  );
  if (!hasExtrusion && buildingLayer && "source" in buildingLayer) {
    addLayerOnce(
      {
        id: "buildings-3d",
        type: "fill-extrusion",
        source: buildingLayer.source as string,
        "source-layer": "building",
        minzoom: 12.5,
        paint: {
          // M4: warmed emissive massing in dark mode (dusk-lamp gray, not the
          // old cool blue-gray) — token-derived, matches buildPalette's 2-D
          // building fill so the skyline reads as one warm material. M6
          // (interim, pre-6.x-bump): buildingMassingColorExpr turns that flat
          // base into a two-stop height gradient — squat buildings darken
          // toward inkDeep, tall ones settle back to the same base tone as
          // before, so the overall look is unchanged at the top of the
          // gradient (see buildingMassingColorExpr's own doc comment for why
          // inkDeep and not the theme-flipping `ink`). The light-theme base
          // switches from an alpha-blended tokens.line to the plain hex
          // tokens.line so mixHex (hex-only) can derive its dark stop; the
          // dropped local alpha (0.95) is folded into fill-extrusion-opacity
          // below (0.58 → 0.551) so the overall wash is unchanged.
          "fill-extrusion-color": buildingMassingColorExpr(
            dark ? tokens.buildingEmissive : tokens.line,
            tokens.inkDeep,
          ) as maplibregl.ExpressionSpecification,
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12.5,
            0,
            14,
            ["*", ["coalesce", ["get", "render_height"], ["get", "height"], 14], 1.08],
          ],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": dark ? 0.9 : 0.551,
        },
      },
      firstSymbolId,
    );
  }
}

export function buildTransitLines(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, transitLinesPath, poiHidden } = ctx;
  // --- Transit lines (London TfL by default). Non-London cities pass
  // transitLinesPath=null so we skip the source entirely (no 404).
  if (!transitLinesPath) return;
  if (!map.getSource("tube-lines")) {
    map.addSource("tube-lines", {
      type: "geojson",
      data: transitLinesPath,
      attribution: "Rail lines © TfL / OpenStreetMap contributors (ODbL)",
    });
  }
  const tubeVisibility: "none" | "visible" = isTransitNetworkVisible(poiHidden)
    ? "visible"
    : "none";
  addLayerOnce({
    id: "tube-lines-casing",
    type: "line",
    source: "tube-lines",
    minzoom: 9.5,
    layout: { "line-cap": "round", "line-join": "round", visibility: tubeVisibility },
    paint: {
      "line-color": dark ? "rgba(9,15,12,0.6)" : "rgba(255,255,255,0.8)",
      "line-width": ["interpolate", ["linear"], ["zoom"], 9.5, 2.4, 13, 5.5, 16, 9],
      "line-opacity": 0.75,
      // Fan the sub-surface lines apart (issue #16); centred for all others.
      "line-offset": TUBE_LINE_OFFSET_EXPR,
    },
  });
  addLayerOnce({
    id: "tube-lines-color",
    type: "line",
    source: "tube-lines",
    minzoom: 9.5,
    layout: { "line-cap": "round", "line-join": "round", visibility: tubeVisibility },
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "color"], "#000000"],
        dark ? "#c9c9c9" : "#000000",
        ["get", "color"],
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9.5, 1.1, 13, 3, 16, 5],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0.7, 13, 0.95],
      // Same fan offset as the casing so colour + casing move together.
      "line-offset": TUBE_LINE_OFFSET_EXPR,
    },
  });
  // Line names ride along the route once you zoom in — neutral, high-contrast
  // text (not the line colour, which is unreadable for yellow/pink lines) so
  // the network stays legible over the busy base.
  addLayerOnce({
    id: "tube-lines-label",
    type: "symbol",
    source: "tube-lines",
    minzoom: 13,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 420,
      "text-field": ["get", "line"],
      "text-font": textFont,
      "text-size": 9.5,
      "text-letter-spacing": 0.02,
      visibility: tubeVisibility,
    },
    paint: {
      // Dark night land needs cream `--ink` labels, not dark `--paper`.
      "text-color": dark ? tokens.ink : tokens.inkDeep,
      "text-halo-color": dark ? "rgba(9,8,6,0.92)" : "rgba(255,255,255,0.95)",
      "text-halo-width": 1.7,
    },
  });
}

export function registerSceneIcons(ctx: SceneCtx) {
  const { map, tokens, dark } = ctx;
  // --- Designed marker images: landmark pictograms + TfL symbols, re-tinted
  // from the live theme tokens (a setStyle wipes them, so re-register here).
  const iconTokens: IconTokens = {
    ink: tokens.ink,
    paper: dark ? tokens.inkDeep : tokens.paper,
    brass: tokens.brass,
    brassBright: tokens.brassBright,
    river: tokens.river,
    riverBright: tokens.riverBright,
    pint: tokens.pint,
    amber: tokens.amber,
    brick: tokens.brick,
    muted: tokens.muted,
  };
  registerMapIcons(map, iconTokens);
}

export function buildLandmarks(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, showLandmarks, landmarksGeoJSON } = ctx;
  // --- Landmarks + history layer. Empty cityLandmarks skips the layer so
  // London markers never appear over Manchester (and vice versa).
  if (!showLandmarks) return;
  if (!map.getSource("landmarks")) {
    map.addSource("landmarks", {
      type: "geojson",
      data: landmarksGeoJSON,
    });
  } else {
    (map.getSource("landmarks") as maplibregl.GeoJSONSource).setData(landmarksGeoJSON);
  }
  addLayerOnce({
    id: "landmarks-icon",
    type: "symbol",
    source: "landmarks",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.5, 13, 0.82, 16, 1],
      "icon-allow-overlap": true,
      "text-field": ["get", "name"],
      "text-font": textFont,
      "text-size": 10.5,
      "text-letter-spacing": 0.04,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": tokens.ink,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 1.3,
    },
    minzoom: 9.5,
  });
}

export function buildPois(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, poiHidden, poisData } = ctx;
  // --- Points of interest. Transport (tube/rail/bus/river) render as their
  // real TfL / National Rail symbols on two zoom-gated layers: major
  // interchanges form the skeleton from a wide zoom, minor stops fade in as
  // you go deeper — a transit map revealing detail. Parks/sights stay soft
  // dots. All honour the category toggles (kept across theme rebuilds).
  // Non-London cities keep an empty source (poisPath=null → no fetch).
  if (!map.getSource("pois")) {
    map.addSource("pois", { type: "geojson", data: poisData });
  }
  addLayerOnce({
    id: "pois-transport-major",
    type: "symbol",
    source: "pois",
    minzoom: 9.5,
    filter: transportFilter(poiHidden, true),
    layout: {
      "icon-image": TRANSPORT_ICON_MATCH,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 9.5, 0.4, 13, 0.62, 16, 0.78],
      "icon-allow-overlap": true,
    },
  });
  addLayerOnce({
    id: "pois-transport-minor",
    type: "symbol",
    source: "pois",
    minzoom: 12.4,
    filter: transportFilter(poiHidden, false),
    layout: {
      "icon-image": TRANSPORT_ICON_MATCH,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 12.4, 0.42, 16, 0.66],
      "icon-allow-overlap": false,
    },
    paint: {
      "icon-opacity": ["interpolate", ["linear"], ["zoom"], 12.4, 0, 13.1, 1],
    },
  });
  addLayerOnce({
    id: "pois-transport-label",
    type: "symbol",
    source: "pois",
    minzoom: 13,
    filter: poiFilter(poiHidden, TRANSPORT_CATEGORIES),
    layout: {
      "text-field": ["get", "name"],
      "text-font": textFont,
      "text-size": 10,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": tokens.ink,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 1.2,
    },
  });
  addLayerOnce({
    id: "pois-dot",
    type: "circle",
    source: "pois",
    minzoom: 11,
    filter: poiFilter(poiHidden, AMBIENT_CATEGORIES),
    paint: {
      "circle-color": ["coalesce", ["get", "color"], tokens.muted],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 6],
      "circle-opacity": 0.85,
      "circle-stroke-color": dark ? tokens.inkDeep : tokens.paper,
      "circle-stroke-width": 1.2,
    },
  });
  addLayerOnce({
    id: "pois-label",
    type: "symbol",
    source: "pois",
    minzoom: 12.5,
    filter: poiFilter(poiHidden, AMBIENT_CATEGORIES),
    layout: {
      "text-field": ["get", "name"],
      "text-font": textFont,
      "text-size": 10,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": tokens.ink,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 1.2,
    },
  });
}

export function buildRoute(ctx: SceneCtx) {
  const { map, tokens, addLayerOnce, routeLine } = ctx;
  // --- Crawl route: solid brass underlay + animated brass dash on top.
  if (!map.getSource("route-line")) {
    map.addSource("route-line", { type: "geojson", data: routeLine });
  }
  addLayerOnce({
    id: "route-line",
    type: "line",
    source: "route-line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tokens.brass,
      "line-width": 4,
      "line-opacity": 0.3,
    },
  });
  addLayerOnce({
    id: "route-line-dash",
    type: "line",
    source: "route-line",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": tokens.brassBright,
      "line-width": 2.5,
      "line-opacity": 0.9,
      "line-dasharray": DASH_SEQ[0],
    },
  });
}

export function buildBandCorridor(ctx: SceneCtx) {
  const { map, dark, addLayerOnce, bandCorridor, bandColor } = ctx;
  // --- Story-band corridor (issue #15): a subtle token-tinted line threading
  // the active band's anchor landmarks. Low opacity + a soft blur so it reads
  // as a hint of the walk, never competing with the price-fill pins above it.
  // Sits under the pubs. The colour is the band's token, resolved on the React
  // side and stashed in a ref so a theme rebuild re-reads it.
  if (!map.getSource("band-corridor")) {
    map.addSource("band-corridor", { type: "geojson", data: bandCorridor });
  }
  addLayerOnce({
    id: "band-corridor",
    type: "line",
    source: "band-corridor",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": bandColor,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 16, 16, 30],
      "line-opacity": dark ? 0.16 : 0.14,
      "line-blur": 3,
    },
  });
}

export function buildPubs(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, pubsData, bandMemberIds, bandColor, selectedId } = ctx;
  // --- Pubs: clustered GeoJSON source + designed data-driven layers.
  // clusterRadius / clusterMaxZoom are create-time only (MapLibre does not
  // update them via setData). Theme setStyle clears sources, so rebuilds
  // pick up these values on the next addSource.
  if (!map.getSource("pubs")) {
    map.addSource("pubs", {
      type: "geojson",
      data: pubsData,
      cluster: true,
      // Mobile-first density: aggregate nearby venues into fewer, calmer
      // clusters at city zoom. Drink silhouettes still appear at the same
      // honest uncluster boundary once the user moves in.
      clusterRadius: 42,
      // -1: clusters render up to AND INCLUDING clusterMaxZoom, so this
      // must sit one below the pin layers' minzoom or both draw at 12.x.
      clusterMaxZoom: PIN_UNCLUSTER_ZOOM - 1,
      // M5 — per-cluster price-band mix for the donut markers
      // (components/map/canvas/donutClusters.ts). b0..b3 mirror
      // priceBucket() in geojson.ts (≤£5.50 / >£5.50–≤£7 / >£7 / no price —
      // the same order + colours as the legend/pin fill), accumulated by
      // supercluster itself so no client-side aggregation pass is needed.
      clusterProperties: {
        b0: ["+", ["case", ["==", ["get", "bucket"], 0], 1, 0]],
        b1: ["+", ["case", ["==", ["get", "bucket"], 1], 1, 0]],
        b2: ["+", ["case", ["==", ["get", "bucket"], 2], 1, 0]],
        b3: ["+", ["case", ["==", ["get", "bucket"], 3], 1, 0]],
      },
    });
  }
  // Scraped-pub halo: warm brass ring so Young's / Nicholson's / gazetteer
  // pins read as "from our scrapes" without fighting the drink fill.
  addLayerOnce({
    id: "pubs-scraped-halo",
    type: "circle",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: ["all", ["!", ["has", "point_count"]], ["get", "scraped"]],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8, 15, 13],
      "circle-stroke-color": tokens.brass,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 15, 2.2],
      "circle-stroke-opacity": dark ? 0.75 : 0.7,
      "circle-blur": 0.12,
    },
  });
  // Pint-Drops ring: a river-toned glow + a crisp outline so community
  // activity reads at a glance without muddying the price fill under it.
  addLayerOnce({
    id: "pubs-drops-halo",
    type: "circle",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: ["all", ["!", ["has", "point_count"]], ["get", "drops"]],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 15, 12],
      "circle-stroke-color": tokens.riverBright,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 15, 1.6],
      "circle-stroke-opacity": 0.7,
      "circle-blur": 0.15,
    },
  });
  // W1 What's-On tonight badge: a crisp accent ring on pins with a venueId-
  // joined quiz/sport/deal/music row on tonight (feature prop `whatsOn` = hero
  // kind). Colour reads the kind; timed heroes (quiz/deal/music) get a slightly
  // stronger ring than the untimed "screens live sport" attribute badge. Pure
  // property-driven layer on the EXISTING pubs source — no new source, frozen
  // canvas honoured.
  addLayerOnce({
    id: "pubs-whatson-badge",
    type: "circle",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: ["all", ["!", ["has", "point_count"]], ["has", "whatsOn"]],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 9, 15, 15],
      "circle-stroke-color": [
        "match",
        ["get", "whatsOn"],
        "quiz", tokens.amber,
        "sport", tokens.riverBright,
        "deal", tokens.brassBright,
        "music", tokens.river,
        tokens.brass,
      ] as maplibregl.ExpressionSpecification,
      "circle-stroke-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        11,
        ["case", ["get", "whatsOnTimed"], 1.8, 1.3],
        15,
        ["case", ["get", "whatsOnTimed"], 2.8, 2.1],
      ],
      "circle-stroke-opacity": dark ? 0.9 : 0.85,
      "circle-blur": 0.08,
    },
  });
  // Story-band member halo (issue #15): while a band is active, its member
  // pubs get a token-tinted ring so they read as "part of this walk" — an
  // EMPHASIS only. The price fill under it (pubs-point) is untouched, so the
  // band never fights the price-colour system. Filter is set from a ref so
  // it survives theme rebuilds; empty id list = nothing drawn.
  addLayerOnce({
    id: "band-members-halo",
    type: "circle",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: [
      "all",
      ["!", ["has", "point_count"]],
      ["in", ["get", "id"], ["literal", bandMemberIds]],
    ],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8.5, 15, 14],
      "circle-stroke-color": bandColor,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 15, 2.4],
      "circle-stroke-opacity": dark ? 0.85 : 0.8,
      "circle-blur": 0.1,
    },
  });
  addLayerOnce({
    id: "pubs-point",
    type: "symbol",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["get", "icon"],
      // M7 — the static baseline size. During the once-only entrance ramp
      // (PubMapCanvas, right after settleSceneReady) this gets temporarily
      // overridden per-frame by pinEntranceIconSizeExpr, then restored here.
      "icon-size": PIN_ICON_SIZE_EXPR,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-padding": 2,
    },
    paint: {
      // M1 selection spotlight: non-selected pins dim to SELECTION_DIM_OPACITY
      // once a venue is selected; the selected pin always reads at full
      // opacity. Eased (not snapped) via icon-opacity-transition.
      "icon-opacity": pubIconOpacityExpr(selectedId),
      "icon-opacity-transition": { duration: 250, delay: 0 },
    },
  });
  // Selected pin: a confident double brass ring — a soft outer wash plus a
  // bright inner edge — that lifts the choice above every other pin. M1 adds
  // a breathing pulse (stroke-opacity + stroke-width), driven every frame by
  // the existing RAF loop in PubMapCanvas — paint transitions are disabled
  // here (duration 0) so the manual per-frame writes aren't smoothed/lagged.
  addLayerOnce({
    id: "pubs-selected-glow",
    type: "circle",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: ["==", ["get", "id"], selectedId],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 11, 15, 15],
      "circle-stroke-color": tokens.brass,
      "circle-stroke-width": GLOW_BASE_STROKE_WIDTH,
      "circle-stroke-opacity": GLOW_BASE_STROKE_OPACITY,
      "circle-stroke-width-transition": { duration: 0, delay: 0 },
      "circle-stroke-opacity-transition": { duration: 0, delay: 0 },
      "circle-blur": 0.22,
    },
  });
  addLayerOnce({
    id: "pubs-selected",
    type: "circle",
    source: "pubs",
    minzoom: PIN_UNCLUSTER_ZOOM,
    filter: ["==", ["get", "id"], selectedId],
    paint: {
      "circle-color": "rgba(0,0,0,0)",
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8, 15, 11],
      "circle-stroke-color": tokens.brassBright,
      "circle-stroke-width": 2.2,
      "circle-stroke-opacity": 0.98,
    },
  });
  addLayerOnce({
    id: "clusters",
    type: "circle",
    source: "pubs",
    filter: ["has", "point_count"],
    paint: {
      // Wave J1 — pint → amber → brass by density (not ink-black discs).
      "circle-color": clusterCircleColorExpr(tokens, dark) as maplibregl.ExpressionSpecification,
      "circle-stroke-color": tokens.panelRaised,
      "circle-stroke-width": ["step", ["get", "point_count"], 1.25, 40, 1.5, 100, 1.75],
      "circle-stroke-opacity": 0.95,
      "circle-radius": ["step", ["get", "point_count"], 9, 25, 12, 100, 16],
      "circle-blur": ["step", ["get", "point_count"], 0.02, 40, 0.05, 100, 0.08],
      "circle-opacity": 0.94,
    },
  });
  addLayerOnce({
    id: "cluster-count",
    type: "symbol",
    source: "pubs",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": textFont,
      "text-size": ["step", ["get", "point_count"], 9, 25, 10, 100, 11],
      "text-letter-spacing": 0.02,
    },
    paint: {
      "text-color": dark ? tokens.ink : tokens.inkDeep,
      "text-halo-color": withAlpha(tokens.panelRaised, 0.75),
      "text-halo-width": 1,
    },
  });
}

export function buildRouteStops(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, routeStops } = ctx;
  // --- Route stops (numbered) above everything.
  if (!map.getSource("route-stops")) {
    map.addSource("route-stops", { type: "geojson", data: routeStops });
  }
  addLayerOnce({
    id: "route-stops",
    type: "circle",
    source: "route-stops",
    paint: {
      "circle-color": tokens.inkDeep,
      "circle-radius": 13,
      "circle-stroke-color": tokens.brassBright,
      "circle-stroke-width": 2.5,
    },
  });
  addLayerOnce({
    id: "route-stops-label",
    type: "symbol",
    source: "route-stops",
    layout: {
      "text-field": ["get", "label"],
      "text-font": textFont,
      "text-size": 13,
      "text-allow-overlap": true,
    },
    // Stops are always dark-filled, so the label is the light-side token.
    paint: { "text-color": dark ? tokens.ink : tokens.paper },
  });
  // Pub-name plaque (owner bug: numbered discs alone don't say WHICH pub stop 2
  // is, while ordinary basemap POIs around them are labelled). Engraved-brass
  // text riding beside each numbered disc — a strong paper/ink halo carries it
  // over the pale Liberty basemap and the night land without a background box.
  // Collision-tolerant: text-variable-anchor lets the plaque flip side to dodge
  // neighbours and the default placement drops the odd label in a dense cluster
  // rather than smearing them all — the numbers (allow-overlap) always stay.
  // Zoom-gated at 13.5: below that the whole route can sit in one thumb-width,
  // so plaques would pile up; the discs carry the route until the user leans in.
  addLayerOnce({
    id: "route-stops-name",
    type: "symbol",
    source: "route-stops",
    minzoom: 13.5,
    layout: {
      "text-field": ["get", "stopName"],
      "text-font": textFont,
      "text-size": ["interpolate", ["linear"], ["zoom"], 13.5, 10, 16, 12],
      // Ride beside the numbered disc (radius 13px), flipping side to dodge the
      // route line and neighbouring stops.
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 1.6,
      "text-justify": "auto",
      "text-max-width": 9,
    },
    paint: {
      "text-color": dark ? tokens.brassBright : tokens.brass,
      "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
      "text-halo-width": 2,
      "text-halo-blur": 0.4,
    },
  });
}

export function buildTonight(ctx: SceneCtx) {
  const { map, tokens, dark, textFont, addLayerOnce, tonightData, tonightVisible } = ctx;
  // --- CityMCP "tonight" opportunities: amber/moon pins above route stops,
  // with visibility controlled by parent overlay state and data reseeded via ref.
  try {
    const tonightVisibility: "visible" | "none" = tonightVisible ? "visible" : "none";
    if (!map.getSource("tonight-opportunities")) {
      map.addSource("tonight-opportunities", {
        type: "geojson",
        data: tonightData,
      });
    }
    addLayerOnce({
      id: "tonight-halo",
      type: "circle",
      source: "tonight-opportunities",
      minzoom: 10.5,
      layout: { visibility: tonightVisibility },
      paint: {
        "circle-color": withAlpha(tokens.amber, dark ? 0.24 : 0.2),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 9, 15, 17],
        "circle-stroke-color": withAlpha(tokens.riverBright, dark ? 0.7 : 0.55),
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10.5, 1.1, 15, 2],
        "circle-stroke-opacity": 0.8,
        "circle-blur": 0.35,
      },
    });
    addLayerOnce({
      id: "tonight-point",
      type: "circle",
      source: "tonight-opportunities",
      minzoom: 10.5,
      layout: { visibility: tonightVisibility },
      paint: {
        "circle-color": tokens.amber,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10.5, 4.2, 15, 6.6],
        "circle-stroke-color": dark ? tokens.inkDeep : tokens.paper,
        "circle-stroke-width": 1.4,
        "circle-opacity": 0.96,
      },
    });
    addLayerOnce({
      id: "tonight-label",
      type: "symbol",
      source: "tonight-opportunities",
      minzoom: 13,
      layout: {
        "text-field": ["get", "title"],
        "text-font": textFont,
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 9, 16, 10.5],
        "text-offset": [0, 0.95],
        "text-anchor": "top",
        "text-optional": true,
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        visibility: tonightVisibility,
      },
      paint: {
        "text-color": dark ? tokens.ink : tokens.inkDeep,
        "text-halo-color": dark ? tokens.inkDeep : tokens.paper,
        "text-halo-width": 1.25,
      },
    });
  } catch {
    // CityMCP pins are an additive overlay; a style hiccup must not break the pub map.
  }
}

// Assemble the full scene in the exact original top-to-bottom order. MapLibre
// layer paint order = insertion order, so this order is load-bearing: basemap
// taste → sky/buildings → transit → icons → landmarks → pois → route → band
// corridor → pubs → route stops → tonight. The D2 tile-paint gate and the
// pending-updates flush stay in the component wrapper (they own component refs
// and a construct-scope timer); the gate only toggles visibility on the pub
// layers this function has already added, so running it after assembly is
// behaviour-identical to the original mid-scene position (paint happens after
// the synchronous build returns).
export function assembleScene(ctx: SceneCtx) {
  applySceneTaste(ctx);
  buildSkyAndBuildings(ctx);
  buildTransitLines(ctx);
  registerSceneIcons(ctx);
  buildLandmarks(ctx);
  buildPois(ctx);
  buildRoute(ctx);
  buildBandCorridor(ctx);
  buildPubs(ctx);
  buildRouteStops(ctx);
  buildTonight(ctx);
  applySelectionState(ctx);
}

// M2 · POI-at-initiation gating — re-apply the selection mute after a fresh
// style build. A setStyle (theme swap) wipes every layer and its paint, so the
// previous store's snapshots are stale: clear them, then, if a venue is still
// selected, re-mute (recapturing this style's fresh originals). With nothing
// selected this is a pure clear — the initial city overview stays untouched
// (PRD part c: landmark/POI set visible and unchanged at zero selection).
export function applySelectionState(ctx: SceneCtx) {
  const { map, selectionMuteStore, selectedId } = ctx;
  selectionMuteStore.clear();
  if (selectedId) {
    applySelectionMute(map, true, selectionMuteStore);
  }
}
