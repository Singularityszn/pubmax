/** Visible line once map loading runs longer than the honest slow threshold. */
export const MAP_LOADING_SLOW_LINE = "Still loading pubs…";

/** City-aware primary line for the map held loading frame. */
export function mapLoadingPrimaryLine(cityDisplayName: string): string {
  const trimmed = cityDisplayName.trim();
  if (!trimmed) return "Loading pubs…";
  return `Loading ${trimmed} pubs…`;
}
