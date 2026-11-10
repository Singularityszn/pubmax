export type CompactNightArea = {
  slug: string;
  centre: { lat: number; lng: number };
};

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
