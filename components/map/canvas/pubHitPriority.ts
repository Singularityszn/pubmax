// A pill and the glass under it are the same pub, and the ordinary layers beat
// the selected one (see the comment where this is called).
const PUB_HIT_LAYERS = [
  "pubs-price-pill",
  "pubs-point",
  "pubs-point-selected",
  "pubs-price-pill-selected",
] as const;
export function pubHitOf<T>(byLayer: ReadonlyMap<string, T>): T | undefined {
  for (const layer of PUB_HIT_LAYERS) {
    const hit = byLayer.get(layer);
    if (hit) return hit;
  }
  return undefined;
}
