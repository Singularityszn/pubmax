// Which night one /out listing belongs to, and what that night is called.
//
// /out is a whole-day list: the Weekend chip alone covers Friday, Saturday and
// Sunday evenings, and before this the rows arrived as one undivided run, so a
// reader scanning for Saturday had to read every Friday row to find out where
// Saturday started. The rows are grouped by their own SERVICE day (16:00-04:00,
// the same window the rest of the app uses) and each group is named the way a
// drinker names it: tonight, tomorrow, then the weekday.
//
// A row that publishes no date is not given one. It carries the provider's own
// listed window instead ("tonight", "this weekend"), so it sits in a group that
// states exactly the claim the source made and no more, after the dated nights.

import {
  rowStatedInterval,
  tonightServiceWindow,
  type WhatsOnListedWindow,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export type OutListingDayGroup = {
  /** Stable key: the London service date, or the provider's listed window. */
  key: string;
  label: string;
  rows: WhatsOnRow[];
};

const LISTED_WINDOW_LABEL: Record<WhatsOnListedWindow, string> = {
  tonight: "Tonight",
  tomorrow_night: "Tomorrow",
  this_weekend: "This weekend",
};

const UNDATED_LABEL = "Date to come";

function londonYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function londonNightName(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(ms));
}

/** The service night a row falls in, as its London calendar date, or null. */
export function outListingServiceDay(row: WhatsOnRow): string | null {
  const stated = rowStatedInterval(row);
  if (!stated || !Number.isFinite(stated.startMs)) return null;
  return londonYmd(tonightServiceWindow(stated.startMs).startMs);
}

function rowSortTime(row: WhatsOnRow): number {
  const stated = rowStatedInterval(row);
  if (stated && Number.isFinite(stated.startMs)) return stated.startMs;
  return Number.POSITIVE_INFINITY;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENING_PROBE_MS = 4 * 60 * 60 * 1000;

/**
 * The night names, relative to the reader's own now.
 *
 * "Tonight" and "Tomorrow" are read off the SERVICE day, never off the calendar
 * day: at 01:00 on Saturday the service night is still Friday's, and a group
 * called Tomorrow over Saturday's rows would be a day out for the four hours
 * that matter most on this page.
 */
export function outListingDayLabel(serviceDate: string, now: number): string {
  const today = londonYmd(tonightServiceWindow(now).startMs);
  if (serviceDate === today) return "Tonight";
  const tomorrow = londonYmd(
    tonightServiceWindow(tonightServiceWindow(now).endMs + EVENING_PROBE_MS).startMs,
  );
  if (serviceDate === tomorrow) return "Tomorrow";
  const [year, month, day] = serviceDate.split("-").map(Number);
  if (!year || !month || !day) return serviceDate;
  // Noon UTC on the stated date is inside that London day at either offset, so
  // the weekday it names cannot drift across a BST boundary.
  return londonNightName(Date.UTC(year, month - 1, day) + DAY_MS / 2);
}

/**
 * Every listing, grouped by the night it is on, in the order the nights come.
 *
 * NOTHING IS DROPPED. Every row handed in comes back inside a group: a listing
 * we hold and do not print is a listing the reader was told nothing about, and
 * that is the whole finding this grouping was rewritten for.
 */
export function outListingDayGroups(
  rows: readonly WhatsOnRow[],
  now: number = Date.now(),
): OutListingDayGroup[] {
  const dated = new Map<string, WhatsOnRow[]>();
  const undated = new Map<string, WhatsOnRow[]>();
  for (const row of rows) {
    const serviceDate = outListingServiceDay(row);
    if (serviceDate) {
      const held = dated.get(serviceDate);
      if (held) held.push(row);
      else dated.set(serviceDate, [row]);
      continue;
    }
    const key = row.listedWindow ?? "unknown";
    const held = undated.get(key);
    if (held) held.push(row);
    else undated.set(key, [row]);
  }
  const byTime = (left: WhatsOnRow, right: WhatsOnRow) =>
    rowSortTime(left) - rowSortTime(right) || left.id.localeCompare(right.id);

  const datedGroups: OutListingDayGroup[] = [...dated.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([serviceDate, group]) => ({
      key: serviceDate,
      label: outListingDayLabel(serviceDate, now),
      rows: [...group].sort(byTime),
    }));

  const undatedGroups: OutListingDayGroup[] = [...undated.entries()].map(([key, group]) => ({
    key: `listed:${key}`,
    label:
      key === "unknown"
        ? UNDATED_LABEL
        : LISTED_WINDOW_LABEL[key as WhatsOnListedWindow] ?? UNDATED_LABEL,
    rows: [...group].sort(byTime),
  }));

  return [...datedGroups, ...undatedGroups];
}
