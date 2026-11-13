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
