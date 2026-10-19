// The Pal postcard (PalPostcard.tsx), as pure arithmetic and words: where each
// stop of the night sits on the card, and what the card says. Nothing here
// touches the DOM, so the card on the page and the saved image agree.

export type PalPostcardPoint = { x: number; y: number };

/** The postcard holds at most this many stops; a longer night keeps its ends. */
export const PAL_POSTCARD_MAX_STOPS = 8;

/**
 * The stops of the night, in walking order, on a gentle wave across a box of
 * `width` by `height`, kept `inset` from every edge and `top` from the top
 * edge, which leaves the Pal room to stand above the last stop. The first stop
 * sits low on the left and the last high on the right.
 */
export function palPostcardPoints(
  count: number,
  width: number,
  height: number,
  inset: number,
  top = inset,
): PalPostcardPoint[] {
  const stops = Math.max(0, Math.min(PAL_POSTCARD_MAX_STOPS, Math.floor(count)));
  if (stops === 0) return [];
  const left = inset;
  const span = Math.max(0, width - inset * 2);
  const rise = Math.max(0, height - top - inset);
  return Array.from({ length: stops }, (_, index) => {
    const t = stops === 1 ? 1 : index / (stops - 1);
    // Climbs from the bottom to the top, with a wave so it reads as a walk.
    // The wave is still at both ends, so the walk always arrives climbing.
    const wave = Math.sin(t * Math.PI * 3) * 0.12;
    const level = Math.min(1, Math.max(0, 0.82 - t * 0.64 + wave));
    return { x: left + span * t, y: top + rise * level };
  });
}

/** A smooth path through the points, for the dotted walk between stops. */
export function palPostcardPath(points: readonly PalPostcardPoint[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let path = `M ${first!.x.toFixed(1)} ${first!.y.toFixed(1)}`;
  let previous = first!;
  for (const point of rest) {
    const mid = (previous.x + point.x) / 2;
    path += ` C ${mid.toFixed(1)} ${previous.y.toFixed(1)}, ${mid.toFixed(1)} ${point.y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    previous = point;
  }
  return path;
}

/**
 * The stop names the card can hold: every stop for a short night, else the
 * first ones and the last, so the Pal still stands at the true last stop.
 */
export function palPostcardStops(names: readonly string[]): string[] {
  const clean = names.map((name) => name.trim()).filter((name) => name.length > 0);
  if (clean.length <= PAL_POSTCARD_MAX_STOPS) return clean;
  return [...clean.slice(0, PAL_POSTCARD_MAX_STOPS - 1), clean[clean.length - 1]!];
}

// A night that ends after midnight belongs to the evening it started on: the
// London wall-clock hour, so the clock change never moves the line.
const NIGHT_ROLLOVER_HOUR = 6;

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
  timeZone: "Europe/London",
});

const CARD_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The date line, in London time: "Saturday 17 October 2026". A night finished
 * before six in the morning, London time, is dated the evening before.
 */
export function palPostcardDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const finished = new Date(iso);
  if (Number.isNaN(finished.getTime())) return null;
  const london = LONDON_PARTS.formatToParts(finished);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(london.find((entry) => entry.type === type)?.value);
  const rollBack = value("hour") < NIGHT_ROLLOVER_HOUR ? 1 : 0;
  // The London calendar date at noon UTC, so its weekday never shifts.
  const day = new Date(Date.UTC(value("year"), value("month") - 1, value("day") - rollBack, 12));
  // Built from its parts, so every browser writes it the same way.
  const parts = CARD_DATE.formatToParts(day);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}
