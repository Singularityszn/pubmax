// Route-stop plaque labels: the pub name that rides beside each numbered stop.
// A long name ("The Old Bank of England") is truncated so it never sprawls
// across the route; the ellipsis signals there's more. Trim first so trailing
// spaces don't eat the budget, and drop a trailing space before the ellipsis so
// we never emit "word …".
export const ROUTE_STOP_LABEL_MAX = 18;

export function truncateStopName(
  name: string,
  max = ROUTE_STOP_LABEL_MAX,
): string {
  const trimmed = name.trim();
  if (trimmed.length <= max) return trimmed;
  // Reserve one slot for the single-glyph ellipsis.
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
