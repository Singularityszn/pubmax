import type { Map } from "maplibre-gl";

export const PAL_PICKS_SCRIM_LAYER = "pal-picks-scrim";

export function raisePalPicksScrim(map: Map): void {
  if (map.getLayer(PAL_PICKS_SCRIM_LAYER)
    && map.getStyle()?.layers?.at(-1)?.id !== PAL_PICKS_SCRIM_LAYER) {
    map.moveLayer(PAL_PICKS_SCRIM_LAYER);
  }
}
