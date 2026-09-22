/** Visible line once map loading runs longer than the honest slow threshold. */
export const MAP_LOADING_SLOW_LINE = "Still loading pubs…";

/** How long the held frame waits before it admits the load is taking a while. */
export const MAP_LOADING_SLOW_AFTER_MS = 8_000;

/** City-aware primary line for the map held loading frame. */
export function mapLoadingPrimaryLine(cityDisplayName: string): string {
  const trimmed = cityDisplayName.trim();
  if (!trimmed) return "Loading pubs…";
  return `Loading ${trimmed} pubs…`;
}

/**
 * What the held frame has actually reached. Pin reveal is the only complete
 * answer for city arrivals. National browse instead reveals its painted
 * basemap before zoom-gated venue reads begin.
 */
export type MapLoadingStage = {
  /** National arrival has no city index prerequisite; pubs stream after zoom. */
  nationalBrowse?: boolean;
  pinsRevealed: boolean;
  canvasReady: boolean;
  slimLoaded: boolean;
  slimPinCount: number;
};

/**
 * Whether the held frame stays up. Pin reveal is necessary and not sufficient:
 * above the phone breakpoint the canvas reveals on painted basemap tiles alone,
 * so a reveal that lands while the slim index is still in flight would lift the
 * frame onto a pub-free map. The city index has to have answered as well.
 * National browse has no city index prerequisite at its opening zoom.
 */
export function mapLoadingHeld(stage: MapLoadingStage): boolean {
  if (!stage.pinsRevealed) return true;
  if (stage.nationalBrowse) return false;
  return !stage.slimLoaded && stage.slimPinCount === 0;
}

/** Monotonic progress ladder for the held frame's bar, 0-100. */
export function mapLoadingProgressPercent(stage: MapLoadingStage): number {
  if (!mapLoadingHeld(stage)) return 100;
  if (stage.pinsRevealed || stage.canvasReady) return 85;
  if (stage.slimLoaded && stage.slimPinCount > 0) return 55;
  if (stage.slimLoaded) return 35;
  return 12;
}
