// Honest data-freshness helpers (Wave S3, tightened by the SEO integrity
// cleanup). The fact layer must stamp every derived stat with WHEN the
// underlying prices were collected — never a fabricated "live" timestamp and
// never a build artifact dressed up as a collection date.
//
// Two distinct signals, deliberately kept apart:
//   • PINT_DATASET_OBSERVED_AT — the dataset's real collection date. Drives
//     every user-facing "collected" stamp and the JSON-LD dates.
//   • The bundled file's mtime says only "this file was last written" (builds,
//     re-exports), never when prices were collected; app/sitemap.ts derives its
//     `lastModified` from that mtime with its own local helper.
//
// Pure formatters keep no disk access, so they can be unit-tested on fixed
// Dates.

/** The bundled London pint-price dataset every borough/index page reads. */
export const PINT_DATASET_FILE = "pint_prices_app_dataset.json";

/**
 * The calendar day the bundled dataset's prices were collected — the July
 * 2026 snapshot recorded in data/README.md (2026-07-03T23:10:47Z). Stored
 * date-only, anchored at NOON UTC, so no timezone conversion can move the
 * day: the raw 23:10 UTC instant is already 4 July in Europe/London, which
 * would make the visible stamp ("4 July 2026") disagree with the JSON-LD ISO
 * date (2026-07-03). Noon UTC renders as 3 July in London (BST or GMT) and
 * slices to 2026-07-03 in ISO — one day, everywhere; a regression test pins
 * the two representations together.
 * Update whenever the dataset is re-collected (the dataset JSON is a bare
 * array, so the date can't ride inside the file without a breaking shape
 * change — making this machine-readable from one metadata source is a noted
 * follow-up).
 */
export const PINT_DATASET_OBSERVED_AT = new Date("2026-07-03T12:00:00Z");

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

/** "16 July 2026" — the "Prices last collected {date}" stamp. */
export function formatObservedDate(date: Date): string {
  return FULL_DATE.format(date);
}

/** ISO date (YYYY-MM-DD) for JSON-LD dateModified / temporalCoverage. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
