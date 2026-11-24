// Out L1 listing policy. The page composes existing What's-On rows into
// Tonight / Tomorrow / Weekend chips. No new API.

import {
  WHATS_ON_KINDS,
  filterTonight,
  type WhatsOnKind,
  type WhatsOnRow,
} from "@/lib/whatsOn";
import { londonDayKey } from "@/lib/londonHour";

const OUT_DAY_WINDOWS = ["tonight", "tomorrow", "weekend"] as const;
export type OutDayWindow = (typeof OUT_DAY_WINDOWS)[number];

/**
 * Which SPINE kinds reach /out: everything the What's-On vocabulary holds
 * except deals. This is a filter over `WHATS_ON_KINDS`, and it is a different
 * question from what a row is CALLED on screen, which is
 * `OUT_LISTING_KINDS` in lib/out/listingKind.ts.
 *
 * Stated as the one exclusion rather than as a list of three, so a kind added
 * to the shared taxonomy later - the L2 events lane is the next one - reaches
 * this page the day it lands instead of being silently dropped by an allow-list
 * nobody remembered to widen. A deal is not an event: it has its own honesty
 * lane (lib/dealsHonesty.ts) and stays on Tonight.
 */
const OUT_EXCLUDED_LISTING_KIND: WhatsOnKind = "deal";

export const OUT_LISTING_KINDS: readonly WhatsOnKind[] = WHATS_ON_KINDS.filter(
  (kind) => kind !== OUT_EXCLUDED_LISTING_KIND,
);

/** The way onward that the Open plans section on Tonight offers. */
export const OUT_OPEN_PLANS_WAY_LABEL = "Start a plan";

const WINDOW_NOUN: Record<OutDayWindow, string> = {
  tonight: "tonight",
  tomorrow: "tomorrow",
  weekend: "this weekend",
};

/**
 * The window as a sentence names it. One table feeds every line that names the
 * window, so no two of them can disagree about which night the reader asked
 * for.
 */
export function outWindowNoun(window: OutDayWindow): string {
  return WINDOW_NOUN[window];
}

function isOutDayWindow(value: unknown): value is OutDayWindow {
  return (OUT_DAY_WINDOWS as readonly string[]).includes(value as string);
}

export function parseOutDayWindow(value: string | null | undefined): OutDayWindow {
  return isOutDayWindow(value) ? value : "tonight";
}

/** The Out API names tonight as `today`. */
export function outWindowToApiDay(window: OutDayWindow): "today" | "tomorrow" | "weekend" {
  return window === "tonight" ? "today" : window;
}

function addCalendarDays(ymd: string, days: number): string {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = ymd.split("-").map(Number);
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
  const today = londonDayKey(now);
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
    const tomorrow = addCalendarDays(londonDayKey(now), 1);
    return listed.filter((row) => row.startsAt && londonDayKey(Date.parse(row.startsAt)) === tomorrow);
  }
  const days = weekendYmds(now);
  return listed.filter((row) => row.startsAt && days.has(londonDayKey(Date.parse(row.startsAt))));
}
