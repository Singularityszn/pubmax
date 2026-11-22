import type * as maplibregl from "maplibre-gl";

// Every setData makes the MapLibre worker re-index the source and the map
// re-place its symbols. During the opening stream the same features were sent
// again for each shard that landed, so a source skips a write that changes
// none of its features. A caller never mutates a collection after writing it.
const written = new WeakMap<maplibregl.GeoJSONSource, GeoJSON.FeatureCollection>();

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameGeometry(a: GeoJSON.Geometry, b: GeoJSON.Geometry): boolean {
  if (a.type === "Point" && b.type === "Point") {
    return a.coordinates.length === b.coordinates.length && a.coordinates.every((value, index) => value === b.coordinates[index]);
  }
  return sameValue(a, b);
}

function sameFeature(a: GeoJSON.Feature, b: GeoJSON.Feature): boolean {
  if (a === b) return true;
  if (a.id !== b.id || !sameGeometry(a.geometry, b.geometry)) return false;
  const left = a.properties ?? {};
  const right = b.properties ?? {};
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

function sameFeatureCollection(a: GeoJSON.FeatureCollection, b: GeoJSON.FeatureCollection): boolean {
  if (a === b) return true;
  if (a.features.length !== b.features.length) return false;
  return a.features.every((feature, index) => sameFeature(feature, b.features[index]!));
}

/** setData on a GeoJSON source, skipped when the source already holds these features. */
export function writeSourceData(
  map: maplibregl.Map,
  sourceId: string,
  data: GeoJSON.FeatureCollection,
  { force = false }: { force?: boolean } = {},
): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  const previous = written.get(source);
  if (!force && previous && sameFeatureCollection(previous, data)) return;
  written.set(source, data);
  source.setData(data);
}
