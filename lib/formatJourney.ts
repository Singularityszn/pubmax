/**
 * Client-safe TfL journey display helpers. Pure string formatting only —
 * keep this free of Node/fs and of `lib/citymcp/client` so UI components
 * can import it without pulling the server MCP client into the bundle.
 */

function shortMode(mode: string): string {
  const m = mode.trim().toLowerCase();
  if (m === "walking" || m === "walk") return "walk";
  return m.length > 0 ? m : "unknown";
}

/**
 * Compact one-line journey summary, e.g. `"15 min · walk → bus → walk"`.
 * Omits the duration prefix when `durationMinutes` is absent/non-finite.
 */
export function formatJourneyModes(journey: {
  legs: { mode: string }[];
  durationMinutes?: number;
}): string {
  const modes = journey.legs.map((leg) => shortMode(leg.mode)).filter(Boolean);
  const chain = modes.length > 0 ? modes.join(" → ") : "route";
  const mins = journey.durationMinutes;
  if (typeof mins === "number" && Number.isFinite(mins)) {
    return `${Math.round(mins)} min · ${chain}`;
  }
  return chain;
}

/** Alias for UI call sites that already think in "journey summary" terms. */
export function formatJourneySummary(journey: {
  legs: { mode: string }[];
  durationMinutes?: number;
}): string {
  return formatJourneyModes(journey);
}
