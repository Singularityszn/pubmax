// The one answer Last orders needs: how many minutes a pub's SOURCED hours say
// it stays open from an instant. It reads an OSM opening_hours string and the
// England and Wales bank holiday calendar, and nothing else. A string it cannot
// read, a bank holiday the string says nothing about, or a day outside the
// calendar it holds is `unknown`, never open. Pure: the caller passes the clock.

import type { OpeningWindow } from "@/lib/busyness";
import { readOsmOpeningHours, splitHourRules } from "@/lib/osmOpeningHours";

const LAST_ORDERS_TIME_ZONE = "Europe/London";

/**
 * England and Wales bank holidays, as GOV.UK publishes them
 * (https://www.gov.uk/bank-holidays). A day outside these years has no
 * holiday answer, so a pub's hours on it are `unknown` rather than guessed.
 */
export const ENGLAND_WALES_BANK_HOLIDAYS: Readonly<Record<number, readonly string[]>> = {
  2026: [
    "2026-01-01",
    "2026-04-03",
    "2026-04-06",
    "2026-05-04",
    "2026-05-25",
    "2026-08-31",
    "2026-12-25",
    "2026-12-28",
  ],
  2027: [
    "2027-01-01",
    "2027-03-26",
    "2027-03-29",
    "2027-05-03",
    "2027-05-31",
    "2027-08-30",
    "2027-12-27",
    "2027-12-28",
  ],
};

export type ClosingAnswer =
  /** Open now, and the hours name the minute it closes. */
  | { state: "open"; minutesLeft: number; closesAt: string }
  /** Open now, and the hours state no close in the next 24 hours (24/7). */
  | { state: "open-all-night" }
  | { state: "closed" }
  | { state: "unknown"; reason: UnknownHoursReason };

type UnknownHoursReason =
  /** No hours string at all. */
  | "no-hours"
  /** A rule this reader does not read: a month, a comment, school holidays. */
  | "unreadable"
  /** A bank holiday, and the string states no `PH` rule for it. */
  | "holiday-hours-unstated"
  /** A day outside the bank holiday calendar above. */
  | "holiday-calendar-unknown";

/** Hours read into a weekly table plus the bank holiday rule, when stated. */
export type HolidayAwareHours = {
  /** Windows per weekday, 0 = Sunday. An empty list is a closed day. */
  weekly: Record<number, OpeningWindow[]>;
  /** The `PH` rule's windows; an empty list is `PH off`; null when unstated. */
  holiday: OpeningWindow[] | null;
};

const DAY_MINUTES = 24 * 60;
const PH_TOKEN = /^PH$/;
const RULE = /^(.*?)\s+((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*)?)+|off)$/i;

/**
 * Read an OSM opening_hours string with its public holiday rule kept apart.
 * `Su,PH 12:00-19:00` is a Sunday rule AND a holiday rule. Null when any rule
 * is one the shared reader (lib/osmOpeningHours.ts) does not read.
 */
export function readHolidayAwareHours(raw: string | null | undefined): HolidayAwareHours | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const regularRules: string[] = [];
  let holiday: OpeningWindow[] | null = null;
  for (const rule of splitHourRules(raw.trim())) {
    const match = RULE.exec(rule);
    const days = match ? (match[1] ?? "").split(/\s*,\s*/) : [];
    if (!match || !days.some((day) => PH_TOKEN.test(day))) {
      regularRules.push(rule);
      continue;
    }
    const body = (match[2] ?? "").trim();
    const parsed = readOsmOpeningHours(/^off$/i.test(body) ? "Mo off" : `Mo ${body}`);
    if (!parsed) return null;
    holiday = parsed[1] ?? [];
    const rest = days.filter((day) => !PH_TOKEN.test(day));
    if (rest.length > 0) regularRules.push(`${rest.join(",")} ${body}`);
  }
  const weekly: Record<number, OpeningWindow[]> = {};
  if (regularRules.length > 0) {
    const parsed = readOsmOpeningHours(regularRules.join("; "));
    if (!parsed) return null;
    for (let day = 0; day < 7; day += 1) weekly[day] = parsed[day] ?? [];
  } else if (holiday === null) {
    return null;
  } else {
    // A string that states only `PH ...` says nothing about an ordinary day.
    return { weekly: {}, holiday };
  }
  return { weekly, holiday };
}

type CivilDay = { year: number; ymd: string; weekday: number };

/** The London calendar day and minute an instant falls on. */
export function londonCivilTime(now: Date): { day: CivilDay; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAST_ORDERS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "0";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const date = Number(part("day"));
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  return { day: civilDay(year, month, date), minutes };
}

function civilDay(year: number, month: number, date: number): CivilDay {
  const utc = new Date(Date.UTC(year, month - 1, date));
  const ymd = utc.toISOString().slice(0, 10);
  return { year: utc.getUTCFullYear(), ymd, weekday: utc.getUTCDay() };
}

function shiftDay(day: CivilDay, offset: number): CivilDay {
  const [year = 0, month = 1, date = 1] = day.ymd.split("-").map(Number);
  return civilDay(year, month, date + offset);
}

/** True, false, or null when the calendar above does not cover the year. */
export function isBankHoliday(ymd: string): boolean | null {
  const year = Number(ymd.slice(0, 4));
  const list = ENGLAND_WALES_BANK_HOLIDAYS[year];
  return list ? list.includes(ymd) : null;
}

function clock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 47 || minute > 59) return null;
  return hour * 60 + minute;
}

type DayWindows = { windows: [number, number][] } | { unknown: UnknownHoursReason };

// One calendar day's windows, as minutes from the start of THAT day. A close at
// or before the open runs past midnight, so `18:00-02:00` is [1080, 1560].
function windowsForDay(hours: HolidayAwareHours, day: CivilDay): DayWindows {
  const holiday = isBankHoliday(day.ymd);
  if (holiday === null) return { unknown: "holiday-calendar-unknown" };
  let source: OpeningWindow[] | undefined;
  if (holiday) {
    if (hours.holiday === null) return { unknown: "holiday-hours-unstated" };
    source = hours.holiday;
  } else {
    source = hours.weekly[day.weekday];
    if (source === undefined) return { unknown: "unreadable" };
  }
  const windows: [number, number][] = [];
  for (const window of source) {
    const opens = clock(window.opens);
    const closes = clock(window.closes);
    if (opens === null || closes === null) return { unknown: "unreadable" };
    windows.push([opens, closes <= opens ? closes + DAY_MINUTES : closes]);
  }
  return { windows };
}

// London's offset from UTC at an instant, in minutes: 0 in winter, 60 in summer.
function londonOffsetMinutes(instantMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAST_ORDERS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((wall - Math.floor(instantMs / 60_000) * 60_000) / 60_000);
}

/**
 * The instant a London wall-clock time names: `minutes` from the start of the
 * day `ymd` (past 1440 runs into the next day). Twice a year that is not one
 * instant. When the clocks go back, 01:30 happens twice; when they go forward,
 * 01:30 never happens. Both answer with the EARLIEST candidate, so a close is
 * never placed later than it can be and a countdown never runs long.
 */
export function londonWallClockInstant(ymd: string, minutes: number): number {
  const [year = 0, month = 1, date = 1] = ymd.split("-").map(Number);
  const candidates = [0, 60].map((offset) => ({
    offset,
    instant: Date.UTC(year, month - 1, date, 0, minutes) - offset * 60_000,
  }));
  const valid = candidates.filter((entry) => londonOffsetMinutes(entry.instant) === entry.offset);
  return Math.min(...(valid.length > 0 ? valid : candidates).map((entry) => entry.instant));
}

function formatClock(minutes: number): string {
  const inDay = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(inDay / 60);
  const minute = inDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * How long a pub's sourced hours say it stays open from `now`.
 *
 * A window from yesterday that runs past midnight counts, so a Friday
 * `11:00-26:30` is still open at 01:00 on Saturday with 90 minutes left.
 * Windows that touch (`Fr 12:00-24:00; Sa 00:00-02:00`) are one stretch.
 * The windows are read on London's wall clock, but the minutes left are REAL
 * minutes: the close is turned into an instant (londonWallClockInstant), so a
 * Saturday `18:00-02:05` read at 00:55 GMT on the night the clocks go forward
 * has 10 minutes left, not 70.
 */
export function minutesUntilClose(raw: string | null | undefined, now: Date): ClosingAnswer {
  if (typeof raw !== "string" || !raw.trim()) return { state: "unknown", reason: "no-hours" };
  if (/^24\/7$/i.test(raw.trim())) return { state: "open-all-night" };
  const hours = readHolidayAwareHours(raw);
  if (!hours) return { state: "unknown", reason: "unreadable" };

  const { day: today, minutes } = londonCivilTime(now);
  const yesterday = windowsForDay(hours, shiftDay(today, -1));
  const current = windowsForDay(hours, today);
  const tomorrow = windowsForDay(hours, shiftDay(today, 1));

  // Every stretch on one timeline: minutes from the start of today.
  const spans: [number, number][] = [];
  for (const [offset, entry] of [[-1, yesterday], [0, current], [1, tomorrow]] as const) {
    if ("windows" in entry) {
      for (const [opens, closes] of entry.windows) {
        spans.push([opens + offset * DAY_MINUTES, closes + offset * DAY_MINUTES]);
      }
    }
  }
  const covering = spans.find(([opens, closes]) => opens <= minutes && minutes < closes);
  if (!covering) {
    if ("unknown" in current) return { state: "unknown", reason: current.unknown };
    if ("unknown" in yesterday) return { state: "unknown", reason: yesterday.unknown };
    return { state: "closed" };
  }

  // Follow touching stretches to the real close. A day we cannot read ends the
  // walk early, which can only make the answer shorter, never longer.
  let close = covering[1];
  for (let step = 0; step < spans.length; step += 1) {
    const next = spans.find(([opens, closes]) => opens <= close && closes > close);
    if (!next) break;
    close = next[1];
  }
  const closeInstant = londonWallClockInstant(today.ymd, close);
  const minutesLeft = Math.floor((closeInstant - now.getTime()) / 60_000);
  if (minutesLeft <= 0) return { state: "closed" };
  if (minutesLeft >= DAY_MINUTES) return { state: "open-all-night" };
  return { state: "open", minutesLeft, closesAt: formatClock(close) };
}
