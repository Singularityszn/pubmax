// Honest data-freshness helpers (Wave S3). The programmatic fact layer must
// stamp every derived stat with WHEN the underlying data was last observed —
// never a fabricated "live" timestamp (PRD non-negotiable: no fake freshness).
//
// Freshness is derived exactly the way app/sitemap.ts derives `lastModified`:
// from the mtime of the bundled data file the page reads. That's the most
// honest signal we have without a per-row observation date on every venue —
// it says "this dataset file was last refreshed on <date>", nothing stronger.
//
// Pure formatters are split out from the fs read so they can be unit-tested on
// fixed Dates with no disk access.

import { promises as fs } from "node:fs";
import path from "node:path";

/** The bundled London pint-price dataset every borough/index page reads. */
export const PINT_DATASET_FILE = "pint_prices_app_dataset.json";

// mtime of a public/data file as a Date, or `fallback` when it can't be read.
// Mirrors app/sitemap.ts#dataFileModified so the sitemap and the on-page
// freshness stamp never disagree about when the data last changed.
export async function dataFileModified(
  name: string,
  fallback: Date = new Date(),
): Promise<Date> {
  try {
    const stat = await fs.stat(
      path.join(process.cwd(), "public", "data", name),
    );
    return stat.mtime;
  } catch {
    return fallback;
  }
}

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

/** "July 2026" — the observation month for the "As of {month year}" lead. */
export function formatMonthYear(date: Date): string {
  return MONTH_YEAR.format(date);
}

/** "16 July 2026" — the "Prices last observed {date}" stamp. */
export function formatObservedDate(date: Date): string {
  return FULL_DATE.format(date);
}

/** ISO date (YYYY-MM-DD) for JSON-LD dateModified / temporalCoverage. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
