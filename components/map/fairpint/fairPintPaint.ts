import type { ExpressionSpecification, Map } from "maplibre-gl";
import { fairPintSession, subscribeFairPintPaint } from "@/lib/fairPint";
const wires = new WeakMap<Map, () => void>();
export function fairPintOpacity(pence: number, cluster = false): ExpressionSpecification {
  return ["case", ["<=", ["coalesce", ["get", cluster ? "minFairPence" : "fairPence"], 2147483647], pence], 1, 0.25];
}
export function wireFairPintPaint(map: Map) {
  wires.get(map)?.();
  const layers = [["pubs-point", "icon-opacity"], ["pubs-point", "text-opacity"], ["pubs-price-pill", "icon-opacity"], ["pubs-price-pill", "text-opacity"], ["clusters", "circle-opacity"], ["clusters-casing", "circle-opacity"], ["cluster-count", "text-opacity"], ["cluster-count-badge", "text-opacity"]] as const;
  const baseline = layers.map(([id, property]) => map.getLayer(id) ? map.getPaintProperty(id, property) : 1);
  const transitions = layers.map(([id, property]) => map.getLayer(id) ? map.getPaintProperty(id, `${property}-transition`) : null);
  const sync = () => {
    const { active, pence } = fairPintSession();
    layers.forEach(([id, property], index) => {
      if (!map.getLayer(id)) return;
      const value = active ? fairPintOpacity(pence, id.startsWith("cluster")) : baseline[index];
      const transition = active ? { duration: 0, delay: 0 } : transitions[index] ?? undefined;
      if (JSON.stringify(map.getPaintProperty(id, `${property}-transition`)) !== JSON.stringify(transition)) map.setPaintProperty(id, `${property}-transition`, transition);
      if (JSON.stringify(map.getPaintProperty(id, property)) !== JSON.stringify(value)) map.setPaintProperty(id, property, value);
    });
  };
  const unsubscribe = subscribeFairPintPaint(sync);
  map.on("idle", sync);
  const dispose = () => { unsubscribe(); map.off("idle", sync); map.off("remove", dispose); };
  map.on("remove", dispose); wires.set(map, dispose); sync();
}
