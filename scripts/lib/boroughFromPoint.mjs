/**
 * Point-in-polygon borough lookup for Greater London.
 * Mirrors scripts/export_app_dataset_json.py against london_boroughs_simplified.json.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BOROUGH_PATH = join(ROOT, "data/london_boroughs_simplified.json");

let cachedIndex = null;

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function loadBoroughIndex() {
  if (cachedIndex) return cachedIndex;
  const data = JSON.parse(readFileSync(BOROUGH_PATH, "utf8"));
  const index = [];
  for (const feature of data.features) {
    const geometry = feature.geometry;
    const polygons =
      geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const rings of polygons) {
      index.push([feature.properties.name, rings]);
    }
  }
  cachedIndex = index;
  return index;
}

export function boroughForPoint(lat, lng, index = loadBoroughIndex()) {
  for (const [name, rings] of index) {
    if (
      pointInRing(lng, lat, rings[0]) &&
      !rings.slice(1).some((hole) => pointInRing(lng, lat, hole))
    ) {
      return name;
    }
  }
  let bestName = "";
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const [name, rings] of index) {
    for (const [x, y] of rings[0]) {
      const d2 = (x - lng) ** 2 + (y - lat) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestName = name;
      }
    }
  }
  return bestName;
}
