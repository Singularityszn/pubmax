/**
 * The Europe/London wall clock — pub presence follows London evenings
 * regardless of where the server runs. Deterministic for a given Date.
 *
 * This module stays independent because main navigation reads it through
 * useNowHref on every route. Importing lib/ambientPresence for the hour once
 * shipped the demo Pint Drop rosters to every route for one Intl call.
 *
 * The formatter is built ONCE and held. `useSyncExternalStore` calls its
 * snapshot on every render and on every store notification, so a formatter
 * constructed per call is built on a hot path for an answer that moves twice a
 * day.
 */

export const LONDON_DAY_MS = 24 * 60 * 60 * 1000;

let clockFormatter: Intl.DateTimeFormat | null = null;

function londonClock(): Intl.DateTimeFormat {
  clockFormatter ??= new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
  return clockFormatter;
}

/**
 * Milliseconds since London midnight, 0 to 86_399_999.
 *
 * A single reading of the whole wall clock, so the hour and the offset into it
 * can never come from two different formatter calls straddling a second.
 */
export function londonMsSinceMidnight(date: Date): number {
  const parts = londonClock().formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((item) => item.type === type)?.value);
  // Intl renders midnight as "24" in some ICU builds — normalize to 0–23.
  const hour = part("hour") % 24;
  const minute = part("minute");
  const second = part("second");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
    return 0;
  }
  const millisecond = ((date.getTime() % 1000) + 1000) % 1000;
  return ((hour * 60 + minute) * 60 + second) * 1000 + millisecond;
}

let dayKeyFormatter: Intl.DateTimeFormat | null = null;

/** The Europe/London calendar day, YYYY-MM-DD. The key sorts in date order. */
export function londonDayKey(at: Date | number): string {
  dayKeyFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dayKeyFormatter.format(at);
}

let dayLabelFormatter: Intl.DateTimeFormat | null = null;

/**
 * The Europe/London date a person reads, for example "Friday 13 November".
 * The server dates each landing answer with the same clock used for its facts.
 */
export function londonDayLabel(at: Date | number): string {
  dayLabelFormatter ??= new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
  return dayLabelFormatter.format(at);
}

/** The hour-of-day, 0 to 23, in the Europe/London wall clock. */
export function londonHour(date: Date): number {
  return Math.floor(londonMsSinceMidnight(date) / (60 * 60 * 1000));
}
