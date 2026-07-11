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
};

type PaintMap = {
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
  getLayer: (layerId: string) => unknown;
  getStyle: () => { layers?: Array<{ id: string; type?: string }> };
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
    // Night city — warm candle-lit stone, not cold steel-blue.
    // Buildings must be distinctly lighter than inkDeep land AND warm-toned.
    // Warm stone mid-gray (brown undertone, no blue) so City skyline reads
    // as aged stone, not brushed steel or Apple-Maps-purple.
    // Roads keep amber-cream brightness so streets stay readable at night.
    return {
      land: tokens.inkDeep || tokens.paper,
      // More visible brass-tinted land overlays (landuse / landcover areas).
      landSoft: withAlpha(tokens.brass, 0.18),
      residential: withAlpha(tokens.brass, 0.14),
      // Parks: enough neon to read as green space, not so much it screams.
      park: withAlpha(tokens.pint, 0.24),
      // Warm stone massing — brown-gray lift above inkDeep; no blue component.
      building: "#756a58",
      water: tokens.river,
      road: withAlpha(tokens.ink, 0.88),
      roadMajor: withAlpha(tokens.amber, 0.96),
    };
  }
  return {
    land: tokens.paper,
    landSoft: withAlpha(tokens.amber, 0.14),
    residential: withAlpha(tokens.pint, 0.1),
    park: withAlpha(tokens.pint, 0.26),
    building: withAlpha(tokens.amber, 0.22),
    water: tokens.riverBright,
    road: withAlpha(tokens.brass, 0.55),
    roadMajor: withAlpha(tokens.amber, 0.62),
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
    // Warm gray (brown undertone) to match the warm-stone building fill.
    if (dark) {
      tryPaint(map, id, "fill-outline-color", "#9a8c78");
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
    // Warm gray outline matches warm-stone fill — no cold blue.
    if (dark) {
      tryPaint(map, layerId, "fill-outline-color", "#9a8c78");
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
  // Warm near-black halo (slight red warmth vs pure #040606 cold black).
  const halo = dark ? "#0c0906" : tokens.paper;
  tryPaint(map, layerId, "text-color", text);
  tryPaint(map, layerId, "text-halo-color", halo);
  // Wider halo on dark for crisp cream labels floating above dark land.
  tryPaint(map, layerId, "text-halo-width", dark ? 1.6 : 1.1);
  tryPaint(map, layerId, "text-opacity", dark ? 0.95 : 0.88);
}

function paintDiscoveredLayers(
  map: PaintMap,
  palette: TastePalette,
  tokens: BasemapTasteTokens,
  dark: boolean,
): void {
  for (const layer of map.getStyle().layers ?? []) {
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
