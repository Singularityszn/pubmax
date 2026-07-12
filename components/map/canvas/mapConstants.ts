// Scalar + style configuration for the PubMap canvas. Extracted verbatim from
// PubMapCanvas so the canvas file reads as a thin composition root while these
// tunables (styles, camera, timings, the D2 pin-clustering constants) live in
// one place. No behaviour change — same values, same comments.

// OpenFreeMap vector styles — truly keyless, MIT-licensed styles on ODbL/OSM
// data (free for commercial use, unlike CARTO's basemaps), and OpenMapTiles
// schema: a `building` source-layer with `render_height` for our 3-D extrusion.
// "liberty" is a rich, colourful consumer-map look (land-use tints, POI labels,
// road hierarchy); "dark" matches our candle-lit night mode.
export const MAP_STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/liberty",
} as const;

// If OpenFreeMap (community-run) is slow or down, fall back to CARTO's keyless
// vector styles — same OpenMapTiles-ish `building` source-layer so 3-D buildings
// and buildScene keep working. Last resort after this is the WebGL notice.
export const FALLBACK_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;
export const STYLE_LOAD_TIMEOUT_MS = 8000;

// Slightly wider opening London zoom (outer-London P0) so outer boroughs read
// at first glance while drink icons still appear soon after a nudge in.
export const LONDON_VIEW = {
  center: [-0.12, 51.52] as [number, number],
  zoom: 10.7,
  pitch: 42,
  bearing: -12,
};
export const LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.55, 51.28],
  [0.35, 51.72],
];

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
// Hard ceiling on the tile-paint gate: if the map never reaches `idle` (the
// ambient orbit nudges the camera every frame, which on a slow tile connection
// can starve the idle event indefinitely), reveal the pins anyway — a
// briefly-bare basemap beats a permanently pinless map.
export const PIN_REVEAL_TIMEOUT_MS = 3000;
// Every pub-source layer, gated together so pin paint can be withheld until the
// basemap has actually painted (see the tile-paint gate in buildSceneBody).
export const PUB_PIN_LAYERS = [
  "pubs-scraped-halo",
  "pubs-drops-halo",
  "band-members-halo",
  "pubs-point",
  "pubs-selected-glow",
  "pubs-selected",
  "clusters",
  "cluster-count",
] as const;

export const ORBIT_DEG_PER_SEC = 0.7; // gentle drift — a full turn in ~8.5 minutes
export const ORBIT_RESUME_MS = 4500; // stillness before the orbit resumes
export const HOVER_DETAIL_CACHE_LIMIT = 24;
export const HOVER_CARD_VIEWPORT_GUTTER_PX = 16;
export const HOVER_CARD_WIDTH_PX = 292;
export const HOVER_CARD_HEIGHT_PX = 138;
export const HOVER_CARD_MIN_TOP_PX = 84;
export const HOVER_CARD_X_OFFSET_PX = 18;
export const HOVER_CARD_Y_OFFSET_PX = -30;

// Classic "marching ants" dash cycle for the brass route line.
export const DASH_SEQ: number[][] = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

export const TONIGHT_OPPORTUNITY_LAYERS = [
  "tonight-halo",
  "tonight-point",
  "tonight-label",
] as const;
