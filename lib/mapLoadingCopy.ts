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
 * City arrivals wait for tappable pins. An intentional national overview
 * waits for its visible basemap because its pub data is below the zoom gate.
 */
export type MapLoadingStage = {
  pinsRevealed: boolean;
  canvasReady: boolean;
  slimLoaded: boolean;
  slimPinCount: number;
  /** Below-gate national browse intentionally has no curated pin read. */
  nationalOverview?: boolean;
};

/**
 * City arrivals require the pin reveal and an answered index. The national
 * overview requires its canvas handoff instead of an intentionally absent read.
 */
export function mapLoadingHeld(stage: MapLoadingStage): boolean {
  if (!stage.pinsRevealed) return true;
  if (stage.nationalOverview) return !stage.canvasReady;
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
