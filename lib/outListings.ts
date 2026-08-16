// Out L1 listing policy. The page composes existing What's-On rows (music,
// quiz, sport) into Tonight / Tomorrow / Weekend chips. No new API. Deals stay
// on Tonight: they have their own honesty lane and are not events.

import {
  filterTonight,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";

export const OUT_DAY_WINDOWS = ["tonight", "tomorrow", "weekend"] as const;
export type OutDayWindow = (typeof OUT_DAY_WINDOWS)[number];

export const OUT_LISTING_KINDS: readonly WhatsOnKind[] = ["music", "quiz", "sport"];

export function isOutDayWindow(value: unknown): value is OutDayWindow {
  return (OUT_DAY_WINDOWS as readonly string[]).includes(value as string);
}

export function parseOutDayWindow(value: string | null | undefined): OutDayWindow {
  return isOutDayWindow(value) ? value : "tonight";
}

function londonYmd(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function londonWeekdayMon0(ms: number): number {
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Europe/London",
  }).format(new Date(ms));
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(label);
}

function weekendYmds(now: number): Set<string> {
  const today = londonYmd(now);
  const dow = londonWeekdayMon0(now);
  const friday =
    dow <= 4
      ? addCalendarDays(today, 4 - dow)
      : addCalendarDays(today, dow === 5 ? -1 : -2);
  return new Set([friday, addCalendarDays(friday, 1), addCalendarDays(friday, 2)]);
}

function listingKinds(rows: readonly WhatsOnRow[]): WhatsOnRow[] {
  return rows.filter((row) => OUT_LISTING_KINDS.includes(row.kind));
}

/** Rows that belong on the Out chip. Untimed rows only qualify for Tonight. */
export function filterOutListings(
  rows: readonly WhatsOnRow[],
  window: OutDayWindow,
  now: number = Date.now(),
): WhatsOnRow[] {
  const listed = listingKinds(rows);
  if (window === "tonight") return filterTonight(listed, now);
  if (window === "tomorrow") {
    const tomorrow = addCalendarDays(londonYmd(now), 1);
    return listed.filter((row) => row.startsAt && londonYmd(Date.parse(row.startsAt)) === tomorrow);
  }
  const days = weekendYmds(now);
  return listed.filter((row) => row.startsAt && days.has(londonYmd(Date.parse(row.startsAt))));
}
