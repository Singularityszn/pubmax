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

/**
 * Tint basemap fills/lines toward candle-lit paper / river / brass.
 * Best-effort: unknown layer ids are skipped. Safe to call on every style.load.
 */
export function applyBasemapTaste(
  map: PaintMap,
  tokens: BasemapTasteTokens,
  dark: boolean,
): void {
  // Stronger washes so Liberty stops reading as generic grey GIS.
  const land = dark ? tokens.ink : tokens.paper;
  const landSoft = dark
    ? withAlpha(tokens.brass, 0.12)
    : withAlpha(tokens.amber, 0.14);
  const residential = dark
    ? withAlpha(tokens.brass, 0.1)
    : withAlpha(tokens.pint, 0.1);
  const park = dark ? withAlpha(tokens.pint, 0.28) : withAlpha(tokens.pint, 0.26);
  const building = dark
    ? withAlpha(tokens.brass, 0.22)
    : withAlpha(tokens.amber, 0.22);
  const water = dark ? tokens.river : tokens.riverBright;
  const road = dark ? withAlpha(tokens.line, 0.65) : withAlpha(tokens.brass, 0.55);
  const roadMajor = dark ? withAlpha(tokens.brass, 0.55) : withAlpha(tokens.amber, 0.62);

  tryPaint(map, "background", "background-color", land);

  for (const id of LAND_FILL_IDS) {
    if (id.includes("park") || id.includes("wood") || id.includes("grass")) {
      tryPaint(map, id, "fill-color", park);
    } else if (id.includes("residential") || id.includes("school") || id.includes("hospital")) {
      tryPaint(map, id, "fill-color", residential);
    } else if (id.includes("landcover") || id.includes("landuse")) {
      tryPaint(map, id, "fill-color", landSoft);
    } else {
      tryPaint(map, id, "fill-color", land);
    }
  }

  for (const id of BUILDING_FILL_IDS) {
    tryPaint(map, id, "fill-color", building);
    tryPaint(map, id, "fill-opacity", dark ? 0.55 : 0.7);
  }

  for (const id of WATER_FILL_IDS) {
    tryPaint(map, id, "fill-color", water);
    tryPaint(map, id, "line-color", water);
  }

  for (const id of ROAD_LINE_IDS) {
    const major = /motorway|trunk|primary|major|highway_major/i.test(id);
    tryPaint(map, id, "line-color", major ? roadMajor : road);
  }

  // Walk style layers for Liberty/Positron ids the explicit lists missed.
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    if (layer.type === "fill") {
      if (id.includes("building")) {
        tryPaint(map, layer.id, "fill-color", building);
      } else if (id.includes("park") || id.includes("grass") || id.includes("wood")) {
        tryPaint(map, layer.id, "fill-color", park);
      } else if (id.includes("water") && !id.includes("label")) {
        tryPaint(map, layer.id, "fill-color", water);
      } else if (id.includes("residential") || id.includes("school") || id.includes("hospital")) {
        tryPaint(map, layer.id, "fill-color", residential);
      } else if (
        (id.includes("land") || id.includes("earth") || id === "background") &&
        !id.includes("label")
      ) {
        tryPaint(map, layer.id, "fill-color", id.includes("landcover") || id.includes("landuse") ? landSoft : land);
      }
    } else if (layer.type === "line") {
      if (id.includes("water")) {
        tryPaint(map, layer.id, "line-color", water);
      } else if (
        (id.includes("road") || id.includes("highway") || id.includes("street")) &&
        !id.includes("casing") &&
        !id.includes("rail")
      ) {
        const major = /motorway|trunk|primary|major/.test(id);
        tryPaint(map, layer.id, "line-color", major ? roadMajor : road);
      }
    } else if (layer.type === "background") {
      tryPaint(map, layer.id, "background-color", land);
    }
  }
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
