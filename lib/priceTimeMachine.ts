// The pint price time machine (/time-machine): the dated history file read as
// years, and each year as the pubs that hold a dated record in it.
//
// A pure leaf. It reads the parsed history rows and a venue lookup that the
// caller hands in, so it never opens a file and never reads a current price.
// The hard rule at the top of lib/priceHistory.ts holds here too: a row is
// history, and nothing this module returns answers "what does a pint cost here
// now".
//
// IT INVENTS NOTHING. A pub with no dated record in a year is not lit in that
// year, even when it has a record the year before and the year after. No
// price is carried forward, carried back or interpolated between two records,
// and a year with no record at all is an empty year, not a guessed one.

import { formatObservedMonth, type PriceHistoryObservation } from "@/lib/priceHistory";

/** Where a pub sits and what a reader calls it, from the app's own venue index. */
export type TimeMachineVenueRef = {
  name: string;
  lat: number;
  lng: number;
};

/** One pub that can carry a pin: every pub in the history file the index can place. */
export type TimeMachineVenue = {
  venueId: string;
  name: string;
  lat: number;
  lng: number;
};

/** One pub lit in one year: its dated record, as the source states it. */
export type TimeMachineRow = {
  venueId: string;
  name: string;
  priceGbp: number;
  /** The record's calendar day, `YYYY-MM-DD`. */
  observedOn: string;
  /** "June 2019": the granularity the page prints. */
  monthLabel: string;
  sourceLabel: string;
  sourceUrl: string;
  /** False when the venue index cannot place the pub: it is listed, never pinned. */
  placed: boolean;
};

export type TimeMachineData = {
  /** The slider's lower bound: the year of the oldest dated record. */
  minYear: number;
  /** The slider's upper bound: the year of the newest dated record. */
  maxYear: number;
  /** Every pub in the file the index can place, lit or not, name order. */
  venues: TimeMachineVenue[];
  /** Year to the pubs with a dated record in it, cheapest first. A year with none is absent. */
  rowsByYear: Record<number, TimeMachineRow[]>;
};

/** The line the map always carries, so a grey pin is never read as a closed pub. */
export const ONLY_DATED_LINE = "Only pubs with a dated record light up";

/** The calendar year of a `YYYY-MM-DD` day, or null for anything else. */
function yearOf(observedOn: string): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(observedOn);
  return match ? Number(match[1]) : null;
}

/**
 * Build the years and the per-year rows. Null when the file holds no dated
 * row at all, so the page can say so instead of drawing a slider with no
 * bounds.
 *
 * When one pub holds two records in the same year, the year shows the earlier
 * one. Both are true, and the earlier is the one the year opened on; the page
 * never averages them.
 */
export function buildTimeMachine(
  observations: readonly PriceHistoryObservation[],
  lookup: (venueId: string) => TimeMachineVenueRef | null | undefined,
): TimeMachineData | null {
  const byYear = new Map<number, Map<string, PriceHistoryObservation>>();
  const venueIds = new Set<string>();
  for (const row of observations) {
    const year = yearOf(row.observedOn);
    if (year === null) continue;
    venueIds.add(row.venueId);
    const venues = byYear.get(year) ?? new Map<string, PriceHistoryObservation>();
    const held = venues.get(row.venueId);
    if (!held || row.observedOn < held.observedOn) venues.set(row.venueId, row);
    byYear.set(year, venues);
  }
  if (byYear.size === 0) return null;

  const placed = new Map<string, TimeMachineVenue>();
  const names = new Map<string, string>();
  for (const venueId of venueIds) {
    const ref = lookup(venueId);
    if (!ref) continue;
    names.set(venueId, ref.name);
    if (Number.isFinite(ref.lat) && Number.isFinite(ref.lng)) {
      placed.set(venueId, { venueId, name: ref.name, lat: ref.lat, lng: ref.lng });
    }
  }

  const rowsByYear: Record<number, TimeMachineRow[]> = {};
  for (const [year, venues] of byYear) {
    rowsByYear[year] = [...venues.values()]
      .map((row) => ({
        venueId: row.venueId,
        name: names.get(row.venueId) ?? row.venueName,
        priceGbp: row.priceGbp,
        observedOn: row.observedOn,
        monthLabel: formatObservedMonth(row.observedOn),
        sourceLabel: row.source.label,
        sourceUrl: row.source.url,
        placed: placed.has(row.venueId),
      }))
      .sort((a, b) => a.priceGbp - b.priceGbp || a.name.localeCompare(b.name, "en-GB"));
  }

  const years = [...byYear.keys()];
  return {
    minYear: Math.min(...years),
    maxYear: Math.max(...years),
    venues: [...placed.values()].sort((a, b) => a.name.localeCompare(b.name, "en-GB")),
    rowsByYear,
  };
}

/** The pubs lit in a year. An empty list for a year with no dated record. */
export function rowsForYear(data: TimeMachineData, year: number): TimeMachineRow[] {
  return data.rowsByYear[year] ?? [];
}

/**
 * The year a `?year=` value asks for, held to the slider's bounds. Anything
 * that is not a whole year inside them opens the newest year.
 */
export function resolveTimeMachineYear(data: TimeMachineData, raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || !/^\d{4}$/.test(value.trim())) return data.maxYear;
  const year = Number(value.trim());
  return year >= data.minYear && year <= data.maxYear ? year : data.maxYear;
}

/** "£3.10": a recorded price as the page prints it. */
export function formatTimeMachinePrice(priceGbp: number): string {
  return `£${priceGbp.toFixed(2)}`;
}

/** "14 pubs" or "1 pub". */
export function pubCountLabel(count: number): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "pub" : "pubs"}`;
}

/** The share text, word for word: "Pints in 2014: 9 pubs with a dated record". */
export function timeMachineShareText(year: number, count: number): string {
  return `Pints in ${year}: ${pubCountLabel(count)} with a dated record`;
}

/** The page path for one year, the link a share carries. */
export function timeMachinePath(year: number): string {
  return `/time-machine?year=${year}`;
}

/** "The Moon on the Hill, £2.89 in April 2013": one example line on the share card. */
export function timeMachineExampleLine(row: TimeMachineRow): string {
  return `${row.name}, ${formatTimeMachinePrice(row.priceGbp)} in ${row.monthLabel}`;
}
