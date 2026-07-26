import type maplibregl from "maplibre-gl";
import {
  CATEGORY_COLORS,
  categoryVar,
  type DrinkCategory,
} from "@/lib/categoryColors";
import {
  MAP_ICON_SPECS,
  iconId,
  rasterize,
  type IconTokens,
} from "@/lib/mapIcons";

// OpenFreeMap vector styles — truly keyless, MIT-licensed styles on ODbL/OSM
// data (free for commercial use, unlike CARTO's basemaps), and OpenMapTiles
// schema: a `building` source-layer with `render_height` for our 3-D extrusion.
// "liberty" is a rich, colourful consumer-map look (land-use tints, POI labels,
// road hierarchy); "dark" matches our candle-lit night mode.
export const MAP_STYLES = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  // Positron, not Liberty: Liberty is the full-colour OSM look (yellow POIs,
  // pastel landuse) and read as a different product next to the bar-mat dark
  // theme (owner audit). Positron is the muted paper-grey sibling on the same
  // openmaptiles source, so buildScene's building/3-D layers keep working.
  // A fully brand-tinted custom style JSON remains the follow-up.
  light: "https://tiles.openfreemap.org/styles/positron",
} as const;

// If OpenFreeMap (community-run) is slow or down, fall back to CARTO's keyless
// vector styles — same OpenMapTiles-ish `building` source-layer so 3-D buildings
// and buildScene keep working. Last resort after this is the WebGL notice.
export const FALLBACK_STYLES = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
} as const;
export const STYLE_LOAD_TIMEOUT_MS = 8000;

// ODbL attribution for OUR OWN pub data, not the basemap's. The basemap styles
// above ship their own credit inside the style JSON; this line exists because a
// large share of the venues we draw on top of it are themselves OSM-derived
// (the curated index's `outer_london_osm` venues and the whole UK base layer),
// and the OSMF attribution guidelines expect a browsable map to credit the
// contributors in the map corner, not only on an About page.
// https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
//
// Passed as MapLibre's `customAttribution` so it is present on EVERY city and
// every style, including the fallback styles and the non-London cities that
// skip the rail-lines source (whose own attribution is in buildScene).
export const OSM_ATTRIBUTION = "Pub data © OpenStreetMap contributors (ODbL)";

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
export const UK_BOUNDS: [[number, number], [number, number]] = [
  [-8.7, 49.8],
  [1.9, 61],
];


// M1 selection spotlight — non-selected pub pins ease down to this opacity so
// the selected pin reads as unmissable at any zoom. Filtered-out pins (the
// favourite-pint `serves` dim) stay at their existing 0.22 floor either way.
export const SELECTION_DIM_OPACITY = 0.45;
// Selected-glow "breathing" pulse — one continuous sine cycle driven off the
// EXISTING RAF loop (no second requestAnimationFrame). Base values match the
// static pubs-selected-glow paint below so a deselect cleanly resets to them.
export const GLOW_BASE_STROKE_OPACITY = 0.35;
export const GLOW_BASE_STROKE_WIDTH = 3.2;
export const GLOW_PULSE_PERIOD_MS = 1600;
export const GLOW_PULSE_MIN_OPACITY = 0.3;
export const GLOW_PULSE_MAX_OPACITY = 0.62;
export const GLOW_PULSE_MIN_WIDTH = 3;
export const GLOW_PULSE_MAX_WIDTH = 4.6;

// M7 pin entrance — a per-pub icon-size/opacity ramp fired once, right after
// settleSceneReady()'s first pin reveal, off the SAME RAF loop the M1 pulse
// uses (no second requestAnimationFrame). Each pub's own ramp is spread out
// (`entranceSeed`, a hash of its id — see filters.ts pinEntranceLocalT) over
// PIN_ENTRANCE_STAGGER_MS so the cascade isn't mechanical/left-to-right, then
// individually ramps in over PIN_ENTRANCE_RAMP_MS. Stagger + ramp sum to the
// PRD's "~400ms" total. Reduced-motion is a hard skip (see PubMapCanvas) —
// those users keep today's instant pin paint.
export const PIN_ENTRANCE_BUCKETS = 14;
export const PIN_ENTRANCE_STAGGER_MS = 220;
export const PIN_ENTRANCE_RAMP_MS = 180;
export const PIN_ENTRANCE_TOTAL_MS = PIN_ENTRANCE_STAGGER_MS + PIN_ENTRANCE_RAMP_MS;

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

export type Tokens = {
  ink: string;
  inkDeep: string;
  paper: string;
  panelRaised: string;
  line: string;
  muted: string;
  pint: string;
  amber: string;
  brick: string;
  brass: string;
  brassBright: string;
  river: string;
  riverBright: string;
  // Crawl walk-route line colour — dark crimson (light) / bright coral-ember
  // (dark). High-contrast on both basemaps; see buildScene.buildRoute.
  routeLine: string;
  // M4 — dusk/night signature look + light-theme hierarchy audit. Sky gradient
  // (setSky zenith/horizon), warmed 3-D building emissive tint, and a park
  // green kept deliberately distinct from --pint (see theme.css / globals.css).
  skyZenith: string;
  skyHorizon: string;
  buildingEmissive: string;
  parkTint: string;
  // Drink-category accents (E5). ADDITIVE — resolves the live `--cat-*` vars
  // (lib/categoryColors.ts) into the map's token object so a future
  // pin-by-category paint tints a pin by a venue's dominant drink family from
  // the SAME light/dark/legacy source the venue-sheet swatches use. Not wired
  // into any live paint yet: the Venue model carries no honest dominant category
  // (see the ready-to-apply patch in components/map/mapColor.css), and the
  // honesty rule is never to colour a pin by a guessed category.
  cat: Record<DrinkCategory, string>;
};

// Every map colour derives from the app's theme tokens so both modes
// (candle-lit night / positron day guidebook) flip from one system.
export function readTokens(): Tokens {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  // Additive `--cat-*` read: one entry per drink family, resolved from the live
  // computed vars (with the canonical light hex as a fallback) so map consumers
  // never re-hardcode a category palette.
  const cat = Object.fromEntries(
    (Object.keys(CATEGORY_COLORS) as DrinkCategory[]).map((c) => [
      c,
      token(categoryVar(c), CATEGORY_COLORS[c].light),
    ]),
  ) as Record<DrinkCategory, string>;
  return {
    cat,
    ink: token("--ink", "#1b2620"),
    inkDeep: token("--ink-deep", "#0f1c16"),
    paper: token("--paper", "#f4efe4"),
    panelRaised: token("--panel-raised", "#ffffff"),
    line: token("--line", "#ddd5c4"),
    muted: token("--muted", "#6b726a"),
    pint: token("--pint", "#2f8f5b"),
    amber: token("--amber", "#d99f45"),
    brick: token("--brick", "#d16353"),
    brass: token("--brass", "#b0813a"),
    brassBright: token("--brass-bright", "#d3a44a"),
    river: token("--river", "#2f6f8f"),
    riverBright: token("--river-bright", "#4f9ec4"),
    routeLine: token("--route-line", "#8b1a2b"),
    skyZenith: token("--map-sky-zenith", "#0f1c16"),
    skyHorizon: token("--map-sky-horizon", "#b0813a"),
    buildingEmissive: token("--map-building-emissive", "#8f7d6b"),
    parkTint: token("--map-park-tint", "#7ea052"),
  };
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Register every designed marker image (landmark pictograms + TfL symbols) with
// the map, re-tinting from the live theme tokens. Called from buildScene on the
// first load and after each theme-driven setStyle (which wipes prior images).
export function registerMapIcons(map: maplibregl.Map, tokens: IconTokens) {
  for (const spec of MAP_ICON_SPECS) {
    const id = iconId(spec.ns, spec.key);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, rasterize(spec, tokens), { pixelRatio: 2 });
  }
}
