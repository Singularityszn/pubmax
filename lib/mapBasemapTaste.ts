// Wave J1 — warm DESIGN_SYSTEM paint overrides on OpenFreeMap / CARTO basemaps.
// Pure helpers: apply after style.load. Never invents a new tile host.
//
// Dark-mode contract: land must stay night-dark (`inkDeep` / `paper`), never the
// cream `--ink` text token. Roads must stay bright so streets remain readable.

export type BasemapTasteTokens = {
  paper: string;
  panelRaised: string;
  ink: string;
  /** Near-black night land fill — required for dark basemap (not cream `--ink`). */
  inkDeep: string;
  line: string;
  muted: string;
  pint: string;
  amber: string;
  brass: string;
  river: string;
  riverBright: string;
  /** M4 — warm 3-D building massing tint (dark: warmed away from cool land;
   *  light: existing amber-tinted massing). Never brass/coral wash — must
   *  stay readable as a desaturated warm gray against inkDeep. */
  buildingEmissive: string;
  /** M4 — foliage green kept deliberately distinct from `pint` (the "cheap
   *  pint" positive-semantic neon) so parks never read as pint UI colour. */
  parkTint: string;
};

type PaintMap = {
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
  getLayer: (layerId: string) => unknown;
  getStyle: () => { layers?: Array<{ id: string; type?: string }> };
};

/** Superset of PaintMap that can also read a layer's current paint value —
 *  needed by the selection-mute machinery to snapshot originals before muting. */
type MuteMap = PaintMap & {
  getPaintProperty: (layerId: string, name: string) => unknown;
};

type TastePalette = {
  land: string;
  landSoft: string;
  residential: string;
  park: string;
  building: string;
  water: string;
  road: string;
  roadMajor: string;
};

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Linear-RGB blend of two hex colours, `t` = weight toward `hexB` (0..1).
 *  Pure, unit-tested — the token-derivation primitive for M4's light-theme
 *  road hierarchy (mixing panel-raised white with a warm accent) so no new
 *  raw hex literals are needed beyond the named CSS tokens. Falls back to
 *  `hexA` unchanged if either input isn't a plain `#rrggbb`. */
export function mixHex(hexA: string, hexB: string, t: number): string {
  const a = /^#([0-9a-f]{6})$/i.exec(hexA.trim());
  const b = /^#([0-9a-f]{6})$/i.exec(hexB.trim());
  if (!a || !b) return hexA;
  const na = parseInt(a[1], 16);
  const nb = parseInt(b[1], 16);
  const clamp = Math.min(1, Math.max(0, t));
  const mix = (shift: number) => {
    const ca = (na >> shift) & 255;
    const cb = (nb >> shift) & 255;
    return Math.round(ca + (cb - ca) * clamp);
  };
  const r = mix(16);
  const g = mix(8);
  const bch = mix(0);
  return `#${[r, g, bch].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// M6 (interim, pre-6.x-bump) — two-stop `fill-extrusion-color` massing
// gradient for `buildings-3d` (components/map/canvas/buildScene.ts): squat
// buildings sit at a darkened variant of the theme's massing base, tall ones
// settle back to the base tone unchanged, so "keep each theme's current
// overall tone" holds at the top of the gradient and only the low end reads
// darker. Darkens toward `inkDeep` specifically (not `ink`) because `ink`
// flips brightness between themes — cream/bright in dark mode, near-black in
// light mode — while `inkDeep` is the one token that reads as a near-black
// "ink" pigment in BOTH themes (see its own doc comment on BasemapTasteTokens).
// Pure + unit-tested; height source matches buildSkyAndBuildings' own
// fill-extrusion-height coalesce so both paint properties key off the same
// per-building height value.
export function buildingMassingColorExpr(base: string, inkDeep: string): unknown {
  const darkStop = mixHex(base, inkDeep, 0.55);
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "render_height"], ["get", "height"], 14],
    0,
    darkStop,
    60,
    base,
  ];
}

function tryPaint(map: PaintMap, layerId: string, prop: string, value: unknown): void {
  if (!map.getLayer(layerId)) return;
  try {
    map.setPaintProperty(layerId, prop, value);
  } catch {
    // Layer exists but property unsupported for its type — skip.
  }
}

/** Exported for unit tests — dark land must never equal cream ink. */
export function buildPalette(tokens: BasemapTasteTokens, dark: boolean): TastePalette {
  if (dark) {
    // Night city (Apple/Google Maps night pattern): deep cool land, buildings
    // a clear step lighter — M4 warms this massing (buildingEmissive) rather
    // than the old flat cool gray, but stays desaturated: never brass/coral
    // wash (vanishes into inkDeep) and never `--line` alone (too close to
    // land at low alpha). OpenFreeMap dark Liberty uses highway_* ids — keep
    // those bright. Park uses parkTint (M4), never pint — pint is the "cheap
    // pint" UI semantic and must not double as foliage.
    return {
      land: tokens.inkDeep || tokens.paper,
      landSoft: withAlpha(tokens.brass, 0.14),
      residential: withAlpha(tokens.brass, 0.12),
      park: withAlpha(tokens.parkTint, 0.32),
      // Warmed massing (M4) — lifted well above land so footprints read, now
      // with a dusk-lamp warmth instead of the old cool blue-gray.
      building: tokens.buildingEmissive,
      water: tokens.river,
      road: withAlpha(tokens.ink, 0.88),
      roadMajor: withAlpha(tokens.amber, 0.96),
    };
  }
  // Light-theme hierarchy audit (M4): calmer water (was the saturated
  // riverBright cyan, painted opaque — now a translucent wash of the deeper
  // `river` blue so it reads as calm water, not neon); roads brighter than
  // land (was a brass/coral wash near-indistinguishable from the warm paper
  // land — now a near-white minor-road base with a warmer gold major-road
  // tier, both mixed from panelRaised so they read as paper-map streets);
  // park uses parkTint, never pint (see dark branch comment).
  return {
    land: tokens.paper,
    landSoft: withAlpha(tokens.amber, 0.14),
    residential: withAlpha(tokens.pint, 0.1),
    park: withAlpha(tokens.parkTint, 0.26),
    building: withAlpha(tokens.buildingEmissive, 0.22),
    water: withAlpha(tokens.river, 0.6),
    road: withAlpha(mixHex(tokens.panelRaised, tokens.amber, 0.08), 0.85),
    roadMajor: withAlpha(mixHex(tokens.panelRaised, tokens.amber, 0.4), 0.95),
  };
}

/** Explicit OpenFreeMap Liberty + CARTO Positron / Dark Matter ids. */
const LAND_FILL_IDS = [
  "background",
  "land",
  "landcover",
  "landcover-grass",
  "landcover-wood",
  "landcover_wood",
  "landcover_grass",
  "landcover_ice",
  "landcover_sand",
  "landuse",
  "landuse_overlay",
  "landuse_residential",
  "landuse_pitch",
  "landuse_track",
  "landuse_cemetery",
  "landuse_hospital",
  "landuse_school",
  "landuse_park",
  "park",
  "park_national_park",
  "national_park",
];

const BUILDING_FILL_IDS = ["building", "building-top", "building_top"];

const WATER_FILL_IDS = [
  "water",
  "water-shadow",
  "waterway",
  "water_intermittent",
  "waterway_river",
  "waterway_other",
  "waterway_tunnel",
];

const ROAD_LINE_IDS = [
  "road",
  "road_minor",
  "road_major",
  "road_trunk",
  "road_motorway",
  "road_motorway_link",
  "road_service_track",
  "road_link",
  "road_secondary_tertiary",
  "road_trunk_primary",
  "road_path_pedestrian",
  // OpenFreeMap dark Liberty highway stack (streets vanish if these stay unpainted).
  "highway_minor",
  "highway_minor_casing",
  "highway_major",
  "highway_major_casing",
  "highway_major_inner",
  "highway_motorway",
  "highway_motorway_casing",
  "highway_path",
  "highway_pedestrian",
  "road-path",
  "road-pedestrian",
  "bridge",
  "tunnel",
];

function isParkish(id: string): boolean {
  return id.includes("park") || id.includes("grass") || id.includes("wood");
}

function isResidentialish(id: string): boolean {
  return id.includes("residential") || id.includes("school") || id.includes("hospital");
}

function isMajorRoad(id: string): boolean {
  return /motorway|trunk|primary|major|highway_major/i.test(id);
}

function landFillColor(id: string, palette: TastePalette): string {
  if (isParkish(id)) return palette.park;
  if (isResidentialish(id)) return palette.residential;
  if (id.includes("landcover") || id.includes("landuse")) return palette.landSoft;
  return palette.land;
}

function paintKnownLayers(map: PaintMap, palette: TastePalette, dark: boolean): void {
  tryPaint(map, "background", "background-color", palette.land);

  for (const id of LAND_FILL_IDS) {
    tryPaint(map, id, "fill-color", landFillColor(id, palette));
  }

  for (const id of BUILDING_FILL_IDS) {
    tryPaint(map, id, "fill-color", palette.building);
    tryPaint(map, id, "fill-opacity", dark ? 0.92 : 0.7);
    // OFM dark outline is rgb(27,27,29) — lift it so edges separate from land.
    if (dark) {
      tryPaint(map, id, "fill-outline-color", "#9aa3b5");
    }
  }

  for (const id of WATER_FILL_IDS) {
    tryPaint(map, id, "fill-color", palette.water);
    tryPaint(map, id, "line-color", palette.water);
  }

  for (const id of ROAD_LINE_IDS) {
    // Dark-only: near-black casings so cream/amber inners read as streets.
    // Light styles keep their stock casing colours.
    if (dark && id.includes("casing")) {
      tryPaint(map, id, "line-color", withAlpha("#090806", isMajorRoad(id) ? 0.55 : 0.4));
      continue;
    }
    if (!dark && id.includes("casing")) continue;
    tryPaint(map, id, "line-color", isMajorRoad(id) ? palette.roadMajor : palette.road);
  }
}

function paintDiscoveredFill(
  map: PaintMap,
  layerId: string,
  id: string,
  palette: TastePalette,
  dark: boolean,
): void {
  if (id.includes("building")) {
    tryPaint(map, layerId, "fill-color", palette.building);
    tryPaint(map, layerId, "fill-opacity", dark ? 0.92 : 0.7);
    if (dark) {
      tryPaint(map, layerId, "fill-outline-color", "#9aa3b5");
    }
    return;
  }
  if (isParkish(id)) {
    tryPaint(map, layerId, "fill-color", palette.park);
    return;
  }
  if (id.includes("water") && !id.includes("label")) {
    tryPaint(map, layerId, "fill-color", palette.water);
    return;
  }
  if (isResidentialish(id)) {
    tryPaint(map, layerId, "fill-color", palette.residential);
    return;
  }
  if ((id.includes("land") || id.includes("earth") || id === "background") && !id.includes("label")) {
    const soft = id.includes("landcover") || id.includes("landuse");
    tryPaint(map, layerId, "fill-color", soft ? palette.landSoft : palette.land);
  }
}

function paintDiscoveredLine(
  map: PaintMap,
  layerId: string,
  id: string,
  palette: TastePalette,
  dark: boolean,
): void {
  if (id.includes("water")) {
    tryPaint(map, layerId, "line-color", palette.water);
    return;
  }
  const isRoad =
    (id.includes("road") || id.includes("highway") || id.includes("street")) &&
    !id.includes("rail");
  if (!isRoad) return;
  if (id.includes("casing")) {
    if (!dark) return;
    tryPaint(map, layerId, "line-color", withAlpha("#090806", 0.45));
    return;
  }
  tryPaint(map, layerId, "line-color", isMajorRoad(id) ? palette.roadMajor : palette.road);
}

function paintDiscoveredSymbol(
  map: PaintMap,
  layerId: string,
  id: string,
  tokens: BasemapTasteTokens,
  dark: boolean,
): void {
  // Retint basemap place/road labels so dark mode doesn't keep Liberty's
  // washed-out grey (or light-theme ink) against night land.
  if (!id.includes("label") && !id.includes("place") && !id.includes("name")) return;
  if (id.includes("icon")) return;
  const text = dark ? tokens.ink : tokens.inkDeep || tokens.ink;
  const halo = dark ? tokens.inkDeep || tokens.paper : tokens.paper;
  tryPaint(map, layerId, "text-color", text);
  tryPaint(map, layerId, "text-halo-color", halo);
  tryPaint(map, layerId, "text-halo-width", dark ? 1.4 : 1.1);
  tryPaint(map, layerId, "text-opacity", dark ? 0.92 : 0.88);
}

/** All layer IDs handled explicitly by paintKnownLayers — skip these in the
 *  discovered pass so the known-layer major/minor paint is never silently
 *  overridden by the broader discovered heuristics. */
const KNOWN_LAYER_IDS = new Set<string>([
  "background",
  ...LAND_FILL_IDS,
  ...BUILDING_FILL_IDS,
  ...WATER_FILL_IDS,
  ...ROAD_LINE_IDS,
]);

function paintDiscoveredLayers(
  map: PaintMap,
  palette: TastePalette,
  tokens: BasemapTasteTokens,
  dark: boolean,
): void {
  for (const layer of map.getStyle().layers ?? []) {
    if (KNOWN_LAYER_IDS.has(layer.id)) continue;
    const id = layer.id.toLowerCase();
    if (layer.type === "fill") {
      paintDiscoveredFill(map, layer.id, id, palette, dark);
    } else if (layer.type === "line") {
      paintDiscoveredLine(map, layer.id, id, palette, dark);
    } else if (layer.type === "background") {
      tryPaint(map, layer.id, "background-color", palette.land);
    } else if (layer.type === "symbol") {
      paintDiscoveredSymbol(map, layer.id, id, tokens, dark);
    }
  }
}

/**
 * Tint basemap fills/lines toward candle-lit paper / river / brass.
 * Best-effort: unknown layer ids are skipped. Safe to call on every style.load.
 */
export function applyBasemapTaste(
  map: PaintMap,
  tokens: BasemapTasteTokens,
  dark: boolean,
): void {
  const palette = buildPalette(tokens, dark);
  paintKnownLayers(map, palette, dark);
  paintDiscoveredLayers(map, palette, tokens, dark);
}

// ── M2 · POI-at-initiation gating ──────────────────────────────────────────
// The owner rule: points of interest belong to the INITIAL city overview only.
// Once a venue is selected the selected pub must dominate, so we heavy-mute the
// label furniture that otherwise drowns it — both our own app layers AND the
// basemap-baked symbol layers (which can't be toggled off, only repainted).
//
// Mute is opacity-only (never visibility), so it composes cleanly with the POI
// category toggles and the tube-network visibility switch: a hidden layer stays
// hidden, a shown one just fades. Originals are snapshotted into a caller-owned
// store before the first mute and set back verbatim on restore, so repeated
// select/deselect cycles are exactly idempotent (an unset prop snapshots as
// `undefined` and restores via setPaintProperty(…, undefined) → style default).

/** Heavy-mute opacity for POI/transit/street furniture while a venue is
 *  selected — PRD's "10-15%" band. A faint ghost of context, never a competitor
 *  for the selected pub. */
export const SELECTION_MUTE_OPACITY = 0.12;

/** Issue #222 — the mute must only ever ATTENUATE a layer's opacity, never
 *  raise it. A flat opacity assignment (the old behaviour) silently raises
 *  any original whose zoom-ramp value is already below SELECTION_MUTE_OPACITY
 *  at the current zoom — e.g. `pois-transport-minor`'s icon-opacity ramps
 *  0→1 across zoom 12.4–13.1 (buildScene.ts); at zoom 12.4 it's invisible
 *  (0), and a flat 0.12 mute would pop it visible. `min` composes with any
 *  original — a plain number, a zoom/data expression, or unset (which
 *  defaults to the style spec's opacity default of 1) — and MapLibre
 *  re-evaluates the whole expression every frame, so the attenuation tracks
 *  a zoom ramp continuously instead of freezing a one-shot snapshot value. */
export function muteOpacityExpr(original: unknown, opacity: number): unknown {
  return ["min", original ?? 1, opacity];
}

// Our own scene layers carry these prefixes; the basemap classifier skips them
// so it only ever matches genuinely baked (stock-style) symbol layers.
const APP_LAYER_PREFIXES = [
  "pubs-",
  "pois-",
  "route-",
  "tube-lines",
  "tonight-",
  "landmarks",
  "cluster",
  "buildings-",
  "band-",
];

// Baked symbol layers whose text/icons are transit roundels, POI labels, or
// street-name labels/shields — the exact furniture the owner rule wants gone on
// selection. Deliberately excludes place labels (city/neighbourhood names —
// legit overview context) and water/waterway labels, and never touches road
// GEOMETRY (those are `line` layers, not `symbol`).
const BASEMAP_MUTE_ID_RE =
  /transit|subway|railway|rail_|station|airport|aeroway|poi|road|street|highway|motorway|junction|shield/;

/** Pure classifier (unit-tested): is this a basemap-baked symbol layer that the
 *  selection mute should touch? */
export function isBasemapSelectionMuteLayer(id: string, type?: string): boolean {
  if (type !== "symbol") return false;
  const s = id.toLowerCase();
  if (APP_LAYER_PREFIXES.some((p) => s.startsWith(p))) return false;
  return BASEMAP_MUTE_ID_RE.test(s);
}

type MuteTarget = { id: string; props: readonly string[] };

/** Our own app layers (PRD part a): POI dots/labels, transport symbols, tube
 *  network, and landmarks — all fade on selection, restore on deselect. Each
 *  lists the opacity paint props valid for its layer type. */
const APP_SELECTION_MUTE_TARGETS: readonly MuteTarget[] = [
  { id: "landmarks-icon", props: ["icon-opacity", "text-opacity"] },
  { id: "pois-transport-major", props: ["icon-opacity"] },
  { id: "pois-transport-minor", props: ["icon-opacity"] },
  { id: "pois-transport-label", props: ["text-opacity"] },
  { id: "pois-dot", props: ["circle-opacity", "circle-stroke-opacity"] },
  { id: "pois-label", props: ["text-opacity"] },
  { id: "tube-lines-casing", props: ["line-opacity"] },
  { id: "tube-lines-color", props: ["line-opacity"] },
  { id: "tube-lines-label", props: ["text-opacity"] },
];

const BASEMAP_MUTE_PROPS = ["text-opacity", "icon-opacity"] as const;

/**
 * Fade (muted=true) or restore (muted=false) every POI/transit/street label
 * layer — both the baked basemap symbols (PRD part b) and our own app layers
 * (part a) — via paint-property opacity. MapLibre's default 300ms paint
 * transition eases the change; no new RAF loop, no React re-render.
 *
 * `store` is caller-owned (a ref) and holds the pre-mute originals keyed by
 * `layerId::prop`. Snapshotted once (guarded by store.has) so a re-mute never
 * captures an already-muted value; restore replays every entry verbatim and
 * clears the store. A style reload wipes the live layers, so the caller must
 * clear the store and re-mute after style.load (see applySelectionState) —
 * exactly the applyBasemapTaste re-apply pattern.
 *
 * Issue #222 — the muted value is never the flat `opacity` literal; it's
 * `muteOpacityExpr(original, opacity)` (`["min", original, opacity]`), so a
 * zoom-ramped original that's already below `opacity` at the current zoom is
 * attenuated further, never raised. `store` always holds the true pre-mute
 * original (re-mute reads it back rather than re-snapshotting the already
 * muted paint value), so nested mute calls can't compound the min().
 */
export function applySelectionMute(
  map: MuteMap,
  muted: boolean,
  store: Map<string, unknown>,
  opacity: number = SELECTION_MUTE_OPACITY,
): void {
  if (muted) {
    const basemapTargets: MuteTarget[] = (map.getStyle().layers ?? [])
      .filter((layer) => isBasemapSelectionMuteLayer(layer.id, layer.type))
      .map((layer) => ({ id: layer.id, props: BASEMAP_MUTE_PROPS }));
    for (const { id, props } of [...basemapTargets, ...APP_SELECTION_MUTE_TARGETS]) {
      if (!map.getLayer(id)) continue;
      for (const prop of props) {
        const key = `${id}::${prop}`;
        if (!store.has(key)) store.set(key, map.getPaintProperty(id, prop));
        tryPaint(map, id, prop, muteOpacityExpr(store.get(key), opacity));
      }
    }
    return;
  }
  // Restore: replay every snapshot verbatim, then clear.
  for (const [key, value] of store) {
    const sep = key.lastIndexOf("::");
    const id = key.slice(0, sep);
    const prop = key.slice(sep + 2);
    if (map.getLayer(id)) tryPaint(map, id, prop, value);
  }
  store.clear();
}

/** Cluster fill by point_count — pint (cheap density) → amber → brass. */
export function clusterCircleColorExpr(tokens: BasemapTasteTokens, dark: boolean): unknown {
  return [
    "step",
    ["get", "point_count"],
    withAlpha(tokens.pint, dark ? 0.82 : 0.88),
    15,
    withAlpha(tokens.amber, dark ? 0.85 : 0.9),
    40,
    withAlpha(tokens.brass, dark ? 0.78 : 0.85),
    100,
    withAlpha(tokens.brass, dark ? 0.92 : 0.95),
  ];
}
