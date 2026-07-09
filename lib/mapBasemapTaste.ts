// Wave J1 — warm DESIGN_SYSTEM paint overrides on OpenFreeMap / CARTO basemaps.
// Pure helpers: apply after style.load. Never invents a new tile host.

export type BasemapTasteTokens = {
  paper: string;
  panelRaised: string;
  ink: string;
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

function buildPalette(tokens: BasemapTasteTokens, dark: boolean): TastePalette {
  return {
    land: dark ? tokens.ink : tokens.paper,
    landSoft: dark ? withAlpha(tokens.brass, 0.12) : withAlpha(tokens.amber, 0.14),
    residential: dark ? withAlpha(tokens.brass, 0.1) : withAlpha(tokens.pint, 0.1),
    park: dark ? withAlpha(tokens.pint, 0.28) : withAlpha(tokens.pint, 0.26),
    building: dark ? withAlpha(tokens.brass, 0.22) : withAlpha(tokens.amber, 0.22),
    water: dark ? tokens.river : tokens.riverBright,
    road: dark ? withAlpha(tokens.line, 0.65) : withAlpha(tokens.brass, 0.55),
    roadMajor: dark ? withAlpha(tokens.brass, 0.55) : withAlpha(tokens.amber, 0.62),
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
  "highway_minor",
  "highway_major",
  "highway_motorway",
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
    tryPaint(map, id, "fill-opacity", dark ? 0.55 : 0.7);
  }

  for (const id of WATER_FILL_IDS) {
    tryPaint(map, id, "fill-color", palette.water);
    tryPaint(map, id, "line-color", palette.water);
  }

  for (const id of ROAD_LINE_IDS) {
    tryPaint(map, id, "line-color", isMajorRoad(id) ? palette.roadMajor : palette.road);
  }
}

function paintDiscoveredFill(map: PaintMap, layerId: string, id: string, palette: TastePalette): void {
  if (id.includes("building")) {
    tryPaint(map, layerId, "fill-color", palette.building);
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

function paintDiscoveredLine(map: PaintMap, layerId: string, id: string, palette: TastePalette): void {
  if (id.includes("water")) {
    tryPaint(map, layerId, "line-color", palette.water);
    return;
  }
  const isRoad =
    (id.includes("road") || id.includes("highway") || id.includes("street")) &&
    !id.includes("casing") &&
    !id.includes("rail");
  if (!isRoad) return;
  tryPaint(map, layerId, "line-color", isMajorRoad(id) ? palette.roadMajor : palette.road);
}

function paintDiscoveredLayers(map: PaintMap, palette: TastePalette): void {
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id.toLowerCase();
    if (layer.type === "fill") {
      paintDiscoveredFill(map, layer.id, id, palette);
    } else if (layer.type === "line") {
      paintDiscoveredLine(map, layer.id, id, palette);
    } else if (layer.type === "background") {
      tryPaint(map, layer.id, "background-color", palette.land);
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
  paintDiscoveredLayers(map, palette);
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
