// Pure formatting helpers for compact Tonight Conditions surfaces.

/**
 * First sentence of the verdict's drink line, for chip-sized surfaces:
 * "Beer garden weather. Lager or cider." -> "Beer garden weather."
 * Empty or whitespace input returns null so a chip can skip the segment.
 */
export function shortDrinkVerdict(drinkLine: string): string | null {
  const trimmed = drinkLine.trim();
  if (!trimmed) return null;
  const stop = trimmed.indexOf(".");
  if (stop === -1) return trimmed;
  return trimmed.slice(0, stop + 1);
}

/** What the strip and the chip say when the area has no weather reading. */
export const NO_WEATHER_READING_LINE = "No weather reading for this area just now.";
