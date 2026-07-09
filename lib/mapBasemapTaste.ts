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

function withAlpha(hex: string, alpha: number): string {
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

/** Match common OpenFreeMap Liberty + CARTO Positron / Dark Matter land layers. */
const LAND_FILL_IDS = [
  "background",
  "land",
  "landcover",
  "landcover-grass",
  "landcover-wood",
  "landuse",
  "landuse_overlay",
  "park",
  "park_national_park",
  "national_park",
];

const WATER_FILL_IDS = ["water", "water-shadow", "waterway", "water_intermittent"];

const ROAD_LINE_IDS = [
  "road",
  "road_minor",
  "road_major",
  "road_trunk",
  "road_motorway",
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
  const land = dark ? tokens.ink : tokens.paper;
  const landSoft = dark ? withAlpha(tokens.brass, 0.08) : withAlpha(tokens.pint, 0.06);
  const park = dark ? withAlpha(tokens.pint, 0.22) : withAlpha(tokens.pint, 0.18);
  const water = dark ? tokens.river : tokens.riverBright;
  const road = dark ? withAlpha(tokens.line, 0.55) : withAlpha(tokens.brass, 0.35);
  const roadMajor = dark ? withAlpha(tokens.brass, 0.45) : withAlpha(tokens.amber, 0.4);

  // Background / canvas
  tryPaint(map, "background", "background-color", land);

  for (const id of LAND_FILL_IDS) {
    if (id.includes("park") || id.includes("wood") || id.includes("grass")) {
      tryPaint(map, id, "fill-color", park);
    } else {
      tryPaint(map, id, "fill-color", id === "landcover" ? landSoft : land);
    }
  }

  for (const id of WATER_FILL_IDS) {
    tryPaint(map, id, "fill-color", water);
    tryPaint(map, id, "line-color", water);
  }

  for (const id of ROAD_LINE_IDS) {
    const major = /motorway|trunk|major|highway_major/i.test(id);
    tryPaint(map, id, "line-color", major ? roadMajor : road);
  }

  // Also walk style layers for id substrings Liberty/Positron use that we missed.
  const layers = map.getStyle().layers ?? [];
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    if (layer.type === "fill") {
      if (id.includes("park") || id.includes("grass") || id.includes("wood")) {
        tryPaint(map, layer.id, "fill-color", park);
      } else if (id.includes("water") && !id.includes("label")) {
        tryPaint(map, layer.id, "fill-color", water);
      } else if (
        (id.includes("land") || id.includes("earth") || id === "background") &&
        !id.includes("label")
      ) {
        tryPaint(map, layer.id, "fill-color", land);
      }
    } else if (layer.type === "line") {
      if (id.includes("water")) {
        tryPaint(map, layer.id, "line-color", water);
      } else if (id.includes("road") || id.includes("highway") || id.includes("street")) {
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
