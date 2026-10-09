// The route draws itself once when a new route arrives: the line grows from
// the first stop to the last. MapLibre has no stroke-dashoffset, so the draw is
// the same LineString cut at a fraction of its own length, and the last frame
// is the whole line, which is what a reduced-motion reader gets straight away.

import { haversineKm } from "@/lib/haversine";

export const ROUTE_DRAW_MS = 600;

/** Ease-in-out: the line gathers pace, then settles on the last stop. */
export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
}

type Position = [number, number];

function lineOf(collection: GeoJSON.FeatureCollection): GeoJSON.Feature<GeoJSON.LineString> | null {
  for (const feature of collection.features) {
    if (feature.geometry.type === "LineString" && feature.geometry.coordinates.length >= 2) {
      return feature as GeoJSON.Feature<GeoJSON.LineString>;
    }
  }
  return null;
}

/** The first `progress` of the line, by length. 1 returns the collection untouched. */
export function partialRouteLine(
  collection: GeoJSON.FeatureCollection,
  progress: number,
): GeoJSON.FeatureCollection {
  const line = lineOf(collection);
  if (!line || progress >= 1) return collection;
  const coordinates = line.geometry.coordinates as Position[];
  if (progress <= 0) return { type: "FeatureCollection", features: [] };

  const lengths: number[] = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]!;
    const here = coordinates[index]!;
    lengths.push(lengths[index - 1]! + haversineKm(previous, here));
  }
  const total = lengths[lengths.length - 1]!;
  if (total <= 0) return collection;
  const target = total * progress;

  const kept: Position[] = [coordinates[0]!];
  for (let index = 1; index < coordinates.length; index += 1) {
    const end = lengths[index]!;
    const here = coordinates[index]!;
    if (end <= target) {
      kept.push(here);
      continue;
    }
    const start = lengths[index - 1]!;
    const previous = coordinates[index - 1]!;
    const share = end === start ? 0 : (target - start) / (end - start);
    kept.push([
      previous[0] + (here[0] - previous[0]) * share,
      previous[1] + (here[1] - previous[1]) * share,
    ]);
    break;
  }
  return {
    type: "FeatureCollection",
    features: [{ ...line, geometry: { type: "LineString", coordinates: kept } }],
  };
}
