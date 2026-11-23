import type * as maplibregl from "maplibre-gl";

type LayerMap = Pick<maplibregl.Map, "getLayer" | "getLayoutProperty" | "setLayoutProperty">;

/** The opening picture holds the canvas transparent while it shows (mapOpeningPreview.css). */
export function canvasUnderOpeningPicture(map: Pick<maplibregl.Map, "getCanvasContainer">): boolean {
  return getComputedStyle(map.getCanvasContainer()).opacity === "0";
}

/**
 * Every visibility write makes MapLibre lay the layer's source out again in the
 * worker, so a layer already in the asked state is left alone.
 */
export function setPinLayersVisible(map: LayerMap, layers: readonly string[], visible: boolean): void {
  for (const id of layers) {
    if (!map.getLayer(id)) continue;
    const hidden = map.getLayoutProperty(id, "visibility") === "none";
    if (hidden !== visible) continue;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}
