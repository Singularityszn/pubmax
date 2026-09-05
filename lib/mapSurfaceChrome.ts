/**
 * What may float on the map surface itself.
 *
 * Search stays. One toast stays. Key, list, price, and filters do not stack
 * over the pins — readers reach the price key and the venue list through
 * Layers (`MapLayersControl` / overlay "layers").
 */

export type MapSurfaceToastKind = "none" | "selection" | "soft-retry";

export function pickMapSurfaceToast(input: {
  selectionNotice: boolean;
  selectionNoticePriority?: boolean;
  softRetry: boolean;
  /**
   * The shell has replaced the canvas with the map's own venue view. That card
   * IS the surface, so an ambient banner describing the map a reader cannot
   * see (a UK place arrival, national browse) is worse than silence, and it
   * lands right on top of the card's pub rows. A selection note still speaks,
   * because it is about the pub the reader asked for rather than the map.
   */
  canvasUnavailable?: boolean;
}): MapSurfaceToastKind {
  if (input.selectionNotice && input.selectionNoticePriority) return "selection";
  if (input.softRetry) return "soft-retry";
  if (input.selectionNotice) return "selection";
  return "none";
}

/**
 * Whether the ambient arrival and national-browse banners may show at all.
 * They are not toasts and never went through `pickMapSurfaceToast`, so the
 * one place a soft retry stood them down could not stand them down here.
 */
export function mapAmbientBannersVisible(input: {
  canvasUnavailable: boolean;
}): boolean {
  return !input.canvasUnavailable;
}
