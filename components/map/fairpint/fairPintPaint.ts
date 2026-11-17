import type { Map as MapLibreMap } from "maplibre-gl";
import { fairPintSession, subscribeFairPintPaint } from "@/lib/fairPint";

const wires = new WeakMap<MapLibreMap, () => void>();
const STATE = "fairPintOpacity";
const layers = [
  ["pubs-point", "icon-opacity"],
  ["pubs-point", "text-opacity"],
  ["pubs-price-pill", "icon-opacity"],
  ["pubs-price-pill", "text-opacity"],
  ["clusters", "circle-opacity"],
  ["clusters-casing", "circle-opacity"],
  ["cluster-count", "text-opacity"],
  ["cluster-count-badge", "text-opacity"],
] as const;

export function fairPintOpacity(listed: unknown, ceiling: number): 1 | 0.25 {
  return typeof listed === "number" && listed <= ceiling ? 1 : 0.25;
}

export function wireFairPintPaint(map: MapLibreMap) {
  wires.get(map)?.();
  const baseline = layers.map(([id, property]) => (map.getLayer(id) ? map.getPaintProperty(id, property) : undefined));
  const transitions = layers.map(([id, property]) =>
    map.getLayer(id) ? map.getPaintProperty(id, `${property}-transition`) : undefined,
  );
  const painted = new Map<string | number, number>();
  let installed = false;
  let frame = 0;

  const syncFeatures = () => {
    frame = 0;
    if (!fairPintSession().active || !map.getSource("pubs")) return;
    for (const feature of map.querySourceFeatures("pubs")) {
      if (feature.id === undefined) continue;
      const properties = feature.properties;
      const listed = properties?.cluster ? properties.minFairPence : properties?.fairPence;
      const opacity = fairPintOpacity(listed, fairPintSession().pence);
      if (painted.get(feature.id) === opacity) continue;
      map.setFeatureState({ source: "pubs", id: feature.id }, { [STATE]: opacity });
      painted.set(feature.id, opacity);
    }
  };
  const schedule = () => {
    if (fairPintSession().active && !frame) frame = requestAnimationFrame(syncFeatures);
  };
  const sync = () => {
    const { active } = fairPintSession();
    if (active !== installed) {
      installed = active;
      layers.forEach(([id, property], index) => {
        if (!map.getLayer(id)) return;
        map.setPaintProperty(
          id,
          `${property}-transition`,
          active ? { duration: 0, delay: 0 } : (transitions[index] ?? undefined),
        );
        map.setPaintProperty(id, property, active ? ["coalesce", ["feature-state", STATE], 0.25] : baseline[index]);
      });
      if (!active) {
        map.removeFeatureState({ source: "pubs" }, STATE);
        painted.clear();
      }
    }
    schedule();
  };
  const content = (event: { sourceId?: string; sourceDataType?: string }) => {
    if (event.sourceId !== "pubs" || event.sourceDataType !== "content") return;
    painted.clear();
    schedule();
  };
  const unsubscribe = subscribeFairPintPaint(sync);
  map.on("sourcedata", content);
  map.on("moveend", schedule);
  map.on("idle", schedule);
  const dispose = () => {
    unsubscribe();
    if (frame) cancelAnimationFrame(frame);
    map.off("sourcedata", content);
    map.off("moveend", schedule);
    map.off("idle", schedule);
    map.off("remove", dispose);
    layers.forEach(([id, property], index) => {
      if (
        !map.getLayer(id) ||
        JSON.stringify(map.getPaintProperty(id, property)) !==
          JSON.stringify(["coalesce", ["feature-state", STATE], 0.25])
      )
        return;
      map.setPaintProperty(id, property, baseline[index]);
      map.setPaintProperty(id, `${property}-transition`, transitions[index] ?? undefined);
    });
  };
  map.on("remove", dispose);
  wires.set(map, dispose);
  sync();
}
