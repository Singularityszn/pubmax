export type CompactNightArea = {
  slug: string;
  centre: { lat: number; lng: number };
};

export function nightAreaBoundaryContains(
  boundary: readonly (readonly [number, number])[] | undefined,
  [lng, lat]: readonly [number, number],
): boolean {
  if (!boundary) return true;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i, i += 1) {
    const [xi, yi] = boundary[i];
    const [xj, yj] = boundary[j];
    const cross = (lng - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (Math.abs(cross) < Number.EPSILON
      && lng >= Math.min(xi, xj) && lng <= Math.max(xi, xj)
      && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Select from the canonical order using the catalogue's viewport distance. */
export function nearestCompactNightArea<T extends CompactNightArea>(
  areas: readonly T[] | undefined,
  [lng, lat]: [number, number],
): T | null {
  return (areas ?? []).slice().sort((left, right) => {
    const leftDistance = Math.hypot((left.centre.lat - lat) * 111, (left.centre.lng - lng) * 70);
    const rightDistance = Math.hypot((right.centre.lat - lat) * 111, (right.centre.lng - lng) * 70);
    return leftDistance - rightDistance;
  })[0] ?? null;
}

/** Return a public area centre, never the viewer's own point. */
export function compactDealAnchor(
  areas: readonly CompactNightArea[] | undefined,
  point: { lat: number; lng: number } | null | undefined,
): CompactNightArea["centre"] | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return nearestCompactNightArea(areas, [point.lng, point.lat])?.centre ?? null;
}
