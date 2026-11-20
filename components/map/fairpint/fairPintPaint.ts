import type { Map as MapLibreMap } from "maplibre-gl";
import type { AllPaintProperties } from "@maplibre/maplibre-gl-style-spec";
import { fairPintSession, subscribeFairPintPaint } from "@/lib/fairPint";

type PaintLease = {
  dispose: () => void;
  retain: (id: string, property: string, value: unknown) => boolean;
};
const wires = new WeakMap<MapLibreMap, PaintLease>();
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

export function setPintPaint<K extends keyof AllPaintProperties>(
  map: MapLibreMap, id: string, property: K, value: AllPaintProperties[K],
): void {
  if (!wires.get(map)?.retain(id, property, value)) map.setPaintProperty(id, property, value);
}

export function fairPintOpacity(listed: unknown, ceiling: number): 1 | 0.25 {
  return typeof listed === "number" && listed <= ceiling ? 1 : 0.25;
}

export function wireFairPintPaint(map: MapLibreMap) {
  wires.get(map)?.dispose();
  const baseline = layers.map(([id, property]) => (map.getLayer(id) ? map.getPaintProperty(id, property) : undefined));
  const transitions = layers.map(([id, property]) =>
    map.getLayer(id) ? map.getPaintProperty(id, `${property}-transition`) : undefined,
  );
  const painted = new Map<string | number, number>();
  let installed = false;
  let restoring = false;
  let frame = 0;

  const restore = () => {
    restoring = false;
    installed = false;
    layers.forEach(([id, property], index) => {
      if (!map.getLayer(id)) return;
      map.setPaintProperty(id, property, baseline[index]);
      map.setPaintProperty(id, `${property}-transition`, transitions[index] ?? undefined);
    });
  };

  const syncFeatures = () => {
    frame = 0;
    if (!fairPintSession().active || !map.getSource("pubs")) return;
    for (const feature of map.querySourceFeatures("pubs")) {
      if (feature.id === undefined) continue;
      const properties = feature.properties;
      const listed = properties?.cluster ? properties.minFairPence : properties?.fairPence;
      const opacity = fairPintOpacity(listed, fairPintSession().pence);
      const target = { source: "pubs", id: feature.id };
      const previous = painted.get(feature.id) ?? map.getFeatureState(target)[STATE] ?? 0.25;
      if (previous !== opacity) map.setFeatureState(target, { [STATE]: opacity });
      painted.set(feature.id, opacity);
    }
  };
  const schedule = () => {
    if (fairPintSession().active && !frame) frame = requestAnimationFrame(syncFeatures);
  };
  const sync = () => {
    const { active } = fairPintSession();
    if (active && restoring) {
      map.off("idle", restore);
      restoring = false;
    }
    if (!active && installed) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!restoring) {
        restoring = true;
        // Drain state updates before replacing MapLibre's state-dependent binders.
        map.removeFeatureState({ source: "pubs" }, STATE);
        painted.clear();
        map.once("idle", restore);
      }
      return;
    }
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
    }
    schedule();
  };
  const content = (event: { sourceId?: string; sourceDataType?: string }) => {
    if (event.sourceId !== "pubs") return;
    painted.clear();
    schedule();
  };
  const unsubscribe = subscribeFairPintPaint(sync);
  map.on("sourcedata", content);
  map.on("moveend", schedule);
  map.on("zoom", schedule);
  map.on("idle", schedule);
  const dispose = () => {
    unsubscribe();
    if (frame) cancelAnimationFrame(frame);
    map.off("sourcedata", content);
    map.off("moveend", schedule);
    map.off("zoom", schedule);
    map.off("idle", schedule);
    map.off("idle", restore);
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
  wires.set(map, {
    dispose,
    retain: (id, property, value) => {
      const index = layers.findIndex(([layer, paint]) =>
        layer === id && (property === paint || property === `${paint}-transition`),
      );
      if (index < 0) return false;
      if (property.endsWith("-transition")) transitions[index] = value as (typeof transitions)[number];
      else baseline[index] = value as (typeof baseline)[number];
      return installed;
    },
  });
  sync();
}
