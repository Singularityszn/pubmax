// en-GB, London time, so "July 2026" / "16 July 2026" read the same wherever
// the build runs — a US-locale build must not stamp a page "7/2026".
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

/** "July 2026" — the collection month for the "As of {month year}" lead. */
export function formatMonthYear(date: Date): string {
  return MONTH_YEAR.format(date);
}

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});

/** "16 Jul" — a dated figure on a card too narrow for the full day. */
export function formatObservedDayShort(date: Date): string {
  return SHORT_DATE.format(date);
}

/** "16 July 2026" — the "Prices last collected {date}" stamp. */
export function formatObservedDate(date: Date): string {
  return FULL_DATE.format(date);
}

/**
 * The words every snapshot caption leads with. Exported so a surface that has
 * to compose its own date element (a `<time>` inside a dense caption, say)
 * still takes the WORDS from here rather than typing them a second time.
 */
export const SNAPSHOT_CAPTION_PREFIX = "Records from";

/**
 * "Records from 16 July 2026" - a point-in-time price lane named as what it
 * is, for a caption that stands on its own.
 *
 * THE ONE COMPOSER of that caption, shared by every lane the freshness spine
 * reports as a `snapshot`: the hand-collected pint bundle, and the per-drink
 * price updates, which carry no refresh path at all (captain ruling
 * 2026-09-05: their only permitted source publishes no per-drink web prices).
 * The date describes the held records. It does not claim that prices are current.
 */
export function formatSnapshotFrom(date: Date): string {
  return `${SNAPSHOT_CAPTION_PREFIX} ${formatObservedDate(date)}`;
}

/** ISO date (YYYY-MM-DD) for JSON-LD dateModified / temporalCoverage. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
