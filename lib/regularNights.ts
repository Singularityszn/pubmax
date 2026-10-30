// Regular nights: the weekly quiz, the weekly music session and the pubs that
// say they show live sport, read from the committed what's-on sources only.
//
// THIS IS NOT TONIGHT'S LISTING, AND NOTHING HERE MAY BE CALLED ONE. A
// confirmed listing comes from the what's-on store's own read for tonight. A
// regular night is what a source said about a weekday, on the day it was read:
// Question One's venue directory for the quizzes (read July 2026), each
// venue's own events page for the music residencies, and Greene King's pub
// pages for "shows live sport". So every row carries its source and its read
// date, and a surface prints both beside it, in a block of its own.
//
// Three rules ride with it.
// 1. NO NEW SOURCE AND NO GUESS. A quiz row counts only when its own text says
//    "every <weekday>", and a music row only when its text or its source's
//    note says the night is weekly. Anything else is dropped, never inferred.
// 2. A SPORT ATTRIBUTE IS NOT A FIXTURE. "Shows live sport" says the pub has
//    screens; it never says a match is on tonight. It has no weekday.
// 3. PURE. The surfaces fetch the three committed files and hand them here;
//    this module reads no clock it is not given and no network.
//
// DRINKER ROWS RIDE BESIDE, NEVER INSIDE. A night a drinker added (with a
// photo of the board, `lib/regularNightReports.ts`) comes from
// `/api/regular-nights` and is parsed here into its own list under its own
// label: "per a drinker, seen <date>", with the reporter's handle until a
// person confirms it. It is never merged into the sourced nights, never into a
// confirmed listing, and never called tonight's listing. A hidden row and an
// expired row are dropped here too, whatever the route sent.

import { formatObservedDate } from "@/lib/dataFreshness";
import { haversineKm } from "@/lib/haversine";
import {
  isLiveRegularNightReport,
  isRegularNightReportKind,
  readRegularNightWeekday,
  REGULAR_NIGHT_REPORT_KIND_LABEL,
  type RegularNightReportKind,
} from "@/lib/regularNightReports";

export const REGULAR_NIGHT_SOURCE_PATHS = {
  quiz: "/data/whats_on/quiz_london.json",
  music: "/data/whats_on/music_london.json",
  sport: "/data/whats_on/sport_attributes.json",
} as const;

export type RegularNightKind = "quiz" | "music" | "sport";

export const REGULAR_NIGHT_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** 0 is Sunday, as `Date#getUTCDay` counts. */
export type RegularNightWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RegularNight = {
  id: string;
  kind: RegularNightKind;
  venueId: string | null;
  placeName: string;
  title: string;
  /** The weekday the source says the night runs on. Null for a sport attribute. */
  weekday: RegularNightWeekday | null;
  /** "19:30", the start the source states. Null when it states none. */
  time: string | null;
  lat: number | null;
  lng: number | null;
  source: { label: string; url: string | null };
  /** ISO instant the source was read. Every row has one, or it is dropped. */
  readAt: string;
};

export type RegularNightFiles = {
  quiz?: unknown;
  music?: unknown;
  sport?: unknown;
};

export type RegularNightsAnswer = {
  weekday: RegularNightWeekday;
  weekdayLabel: (typeof REGULAR_NIGHT_WEEKDAYS)[number];
  /** Quiz and music nights for that weekday, earliest start first. */
  nights: RegularNight[];
  /** Pubs that say they show live sport, nearest first when a point is given. */
  sport: RegularNight[];
  /** Every sport row the source lists, before any cap. */
  sportCount: number;
  /** The OLDEST read among the rows returned, so a newer source cannot redate an older one. */
  readAt: string | null;
  /** Nights drinkers added for that weekday, in a list of their own, earliest start first. */
  drinker: DrinkerRegularNight[];
};

/** A night one drinker added, with a photo behind it. Never a sourced row and never a listing. */
export type DrinkerRegularNight = {
  id: string;
  kind: RegularNightReportKind;
  venueId: string;
  placeName: string;
  title: string;
  weekday: RegularNightWeekday;
  time: string | null;
  note: string;
  /** The day it was reported, or the latest day somebody said it is still on. */
  seenAt: string;
  /** The reporter's handle while no person has checked it; null once confirmed. */
  handle: string | null;
  confirmed: boolean;
  /** The reader reported it themselves (a verified read said so). They get no "Still on". */
  own: boolean;
};

type RawRow = Record<string, unknown>;

function rowsOf(file: unknown): RawRow[] {
  if (Array.isArray(file)) return file.filter(isRecord);
  if (isRecord(file) && Array.isArray(file.rows)) return file.rows.filter(isRecord);
  return [];
}

function isRecord(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validIso(value: unknown): string | null {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : null;
}

// A source label or a title may carry a dash the house voice never prints
// ("Skehan's — Live Music", "Pub quiz — Sundays 7:30pm"). The part before the
// dash is the name; the rest is the page's own heading.
function plainLabel(raw: string): string {
  return raw.split(/\s+[—–-]\s+/)[0]?.trim() ?? raw;
}

function sourceOf(row: RawRow): { label: string; url: string | null } | null {
  const source = isRecord(row.source) ? row.source : null;
  const label = plainLabel(text(source?.label));
  if (!label) return null;
  const url = text(source?.url);
  return { label, url: /^https:\/\//.test(url) ? url : null };
}

function fileReadAt(file: unknown): string | null {
  return isRecord(file) ? validIso(file.generatedAt) : null;
}

function weekdayFromName(name: string): RegularNightWeekday | null {
  const index = REGULAR_NIGHT_WEEKDAYS.findIndex(
    (day) => day.toLowerCase() === name.toLowerCase(),
  );
  return index === -1 ? null : (index as RegularNightWeekday);
}

// The weekday and clock a source wrote into the start it published, read off
// the string itself ("2026-07-19T19:30:00+01:00"), so no time zone conversion
// can move a Sunday night into Monday.
function localStart(startsAt: string): { weekday: RegularNightWeekday; time: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(startsAt);
  if (!match) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (!Number.isFinite(day.getTime())) return null;
  return { weekday: day.getUTCDay() as RegularNightWeekday, time: `${match[4]}:${match[5]}` };
}

const EVERY_WEEKDAY = /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
// A music row is weekly only when it says so for its own dated weekday:
// "every Friday", "Fridays", or "weekly" beside the word "Friday". "Every",
// "recurring" and "residency" alone say nothing about how often, and a row
// that names a monthly or fortnightly rhythm is never weekly (review finding
// 5, PR 2402). An ordinal week is never weekly either, in words or in
// figures, alone or in a list: "2nd Friday", "1st and 3rd Fridays", "last
// Friday" (review P3c, PR 2402).
const ORDINAL = "(?:1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last)";
const NOT_WEEKLY = new RegExp(
  `\\b(monthly|fortnightly|bi-?weekly|every\\s+(other|second|month)|once\\s+a\\s+month|${ORDINAL}(\\s*(,|and|&)\\s*${ORDINAL})*\\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|week)s?|of\\s+(the|each|every)\\s+month)\\b`,
  "i",
);

function saysWeeklyOn(said: string, weekday: RegularNightWeekday): boolean {
  if (NOT_WEEKLY.test(said)) return false;
  const day = REGULAR_NIGHT_WEEKDAYS[weekday]?.toLowerCase();
  if (!day) return false;
  if (new RegExp(`\\bevery\\s+${day}\\b|\\b${day}s\\b`, "i").test(said)) return true;
  return /\bweekly\b/i.test(said) && new RegExp(`\\b${day}\\b`, "i").test(said);
}

function quizNights(file: unknown): RegularNight[] {
  const fallbackRead = fileReadAt(file);
  const out: RegularNight[] = [];
  for (const row of rowsOf(file)) {
    const id = text(row.id);
    const placeName = text(row.placeName);
    const source = sourceOf(row);
    const readAt = validIso(row.observedAt) ?? fallbackRead;
    const stated = EVERY_WEEKDAY.exec(`${text(row.title)} ${text(row.detail)}`);
    const weekday = stated ? weekdayFromName(stated[1] ?? "") : null;
    if (!id || !placeName || !source || !readAt || weekday === null) continue;
    const start = localStart(text(row.startsAt));
    // The stated weekday and the dated start must agree, or the row is unclear.
    if (start && start.weekday !== weekday) continue;
    out.push({
      id,
      kind: "quiz",
      venueId: text(row.venueId) || null,
      placeName,
      title: "Pub quiz",
      weekday,
      time: start?.time ?? null,
      lat: finite(row.lat),
      lng: finite(row.lng),
      source,
      readAt,
    });
  }
  return out;
}

function musicNights(file: unknown): RegularNight[] {
  const fallbackRead = fileReadAt(file);
  const notesByLabel = new Map<string, string>();
  if (isRecord(file) && Array.isArray(file.sources)) {
    for (const source of file.sources.filter(isRecord)) {
      notesByLabel.set(plainLabel(text(source.label)), text(source.notes));
    }
  }
  const out: RegularNight[] = [];
  for (const row of rowsOf(file)) {
    const id = text(row.id);
    const placeName = text(row.placeName);
    const title = plainLabel(text(row.title));
    const source = sourceOf(row);
    const readAt = validIso(row.observedAt) ?? fallbackRead;
    const start = localStart(text(row.startsAt));
    if (!id || !placeName || !title || !source || !readAt || !start) continue;
    const said = `${text(row.title)} ${text(row.detail)} ${notesByLabel.get(source.label) ?? ""}`;
    if (!saysWeeklyOn(said, start.weekday)) continue;
    out.push({
      id,
      kind: "music",
      venueId: text(row.venueId) || null,
      placeName,
      title,
      weekday: start.weekday,
      time: start.time,
      lat: finite(row.lat),
      lng: finite(row.lng),
      source,
      readAt,
    });
  }
  return out;
}

function sportPubs(file: unknown): RegularNight[] {
  const fallbackRead = fileReadAt(file);
  const out: RegularNight[] = [];
  for (const row of rowsOf(file)) {
    const id = text(row.id);
    const placeName = text(row.placeName);
    const source = sourceOf(row);
    const readAt = validIso(row.observedAt) ?? fallbackRead;
    if (!id || !placeName || !source || !readAt) continue;
    out.push({
      id,
      kind: "sport",
      venueId: text(row.venueId) || null,
      placeName,
      title: "Shows live sport",
      weekday: null,
      time: null,
      lat: finite(row.lat),
      lng: finite(row.lng),
      source,
      readAt,
    });
  }
  return out;
}

/** Every regular night the three committed files support, nothing else. */
export function parseRegularNights(files: RegularNightFiles): RegularNight[] {
  return [
    ...quizNights(files.quiz),
    ...musicNights(files.music),
    ...sportPubs(files.sport),
  ];
}

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  hour: "2-digit",
  hourCycle: "h23",
});

/**
 * The weekday a London night belongs to. Before 05:00 the night is still the
 * previous evening's, so a reader at 1am on Saturday is asking about Friday.
 */
export function regularNightsWeekday(now: Date): RegularNightWeekday {
  const parts = LONDON_PARTS.formatToParts(now);
  const name = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "12");
  const weekday = weekdayFromName(name) ?? (now.getUTCDay() as RegularNightWeekday);
  return (hour < 5 ? (weekday + 6) % 7 : weekday) as RegularNightWeekday;
}

function oldestRead(rows: readonly RegularNight[]): string | null {
  let oldest: string | null = null;
  for (const row of rows) {
    if (oldest === null || Date.parse(row.readAt) < Date.parse(oldest)) oldest = row.readAt;
  }
  return oldest;
}

/** How many sport pubs a surface lists before it says how many more. */
export const REGULAR_SPORT_SHOWN = 3;

/**
 * The drinker rows a `/api/regular-nights` answer carries, checked again here:
 * a hidden row, an expired row, a row with no seen date or no pub name, and an
 * open row with no handle to print are all dropped.
 */
export function parseDrinkerRegularNights(payload: unknown, now: number): DrinkerRegularNight[] {
  const reports = isRecord(payload) && Array.isArray(payload.reports) ? payload.reports.filter(isRecord) : [];
  const out: DrinkerRegularNight[] = [];
  for (const row of reports) {
    const id = text(row.id);
    const venueId = text(row.venueId);
    const placeName = text(row.venueName);
    const status = text(row.status);
    const seenAt = validIso(row.lastSeenAt);
    const weekday = readRegularNightWeekday(row.weekday);
    const handle = text(row.handle) || null;
    if (!id || !venueId || !placeName || !seenAt || weekday === null) continue;
    if (!isRegularNightReportKind(row.kind)) continue;
    if (!isLiveRegularNightReport({ status, expiresAt: text(row.expiresAt) }, now)) continue;
    const confirmed = status === "confirmed";
    if (!confirmed && !handle) continue;
    const time = text(row.startTime);
    out.push({
      id,
      kind: row.kind,
      venueId,
      placeName,
      title: REGULAR_NIGHT_REPORT_KIND_LABEL[row.kind],
      weekday,
      time: /^\d{2}:\d{2}$/.test(time) ? time : null,
      note: text(row.note),
      seenAt,
      handle: confirmed ? null : handle,
      confirmed,
      own: row.own === true,
    });
  }
  return out;
}

function byStart(
  a: { time: string | null; placeName: string },
  b: { time: string | null; placeName: string },
): number {
  return (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.placeName.localeCompare(b.placeName);
}

/**
 * The regular nights for one weekday. Quiz and music nights on that day,
 * earliest first; the sport pubs, nearest to `near` first when one is given;
 * and, in a list of their own, the nights drinkers added for that day.
 */
export function regularNightsForWeekday(
  all: readonly RegularNight[],
  weekday: RegularNightWeekday,
  near: { lat: number; lng: number } | null = null,
  drinkerRows: readonly DrinkerRegularNight[] = [],
): RegularNightsAnswer {
  const nights = all
    .filter((row) => row.kind !== "sport" && row.weekday === weekday)
    .sort(byStart);
  const sportAll = all.filter((row) => row.kind === "sport");
  const sport = (near
    ? sportAll
        .filter((row) => row.lat !== null && row.lng !== null)
        .map((row) => ({ row, km: haversineKm([near.lng, near.lat], [row.lng as number, row.lat as number]) }))
        .sort((a, b) => a.km - b.km)
        .map((entry) => entry.row)
    : [...sportAll].sort((a, b) => a.placeName.localeCompare(b.placeName))
  ).slice(0, REGULAR_SPORT_SHOWN);
  return {
    weekday,
    weekdayLabel: REGULAR_NIGHT_WEEKDAYS[weekday],
    nights,
    sport,
    sportCount: sportAll.length,
    readAt: oldestRead([...nights, ...sport]),
    drinker: drinkerRows.filter((row) => row.weekday === weekday).sort(byStart),
  };
}

/** "per a drinker, seen 30 October 2026", the label every drinker row carries. */
export function drinkerRegularNightSourceLine(row: Pick<DrinkerRegularNight, "seenAt">): string {
  return `per a drinker, seen ${formatObservedDate(new Date(row.seenAt))}`;
}

/** Who stands behind it: the reporter's handle, or that a person has checked it. */
export function drinkerRegularNightByline(row: Pick<DrinkerRegularNight, "handle" | "confirmed">): string {
  return row.confirmed || !row.handle ? "checked by a person" : `@${row.handle}`;
}

/** The line over the drinker list: whose word it is, and that it is not tonight’s listing. */
export const DRINKER_REGULAR_NIGHTS_LEAD =
  "Added by drinkers, each with a photo of the board. Not tonight’s listing, so check before you go.";

/** The heading of the drinker list, inside the regular nights block. */
export const DRINKER_REGULAR_NIGHTS_HEADING = "From drinkers";

/** "read 18 July 2026", the read date a regular night always carries. */
export function regularNightReadLabel(readAt: string): string {
  return `read ${formatObservedDate(new Date(readAt))}`;
}

/** "per Question One, read 18 July 2026". */
export function regularNightSourceLine(row: Pick<RegularNight, "source" | "readAt">): string {
  return `per ${row.source.label}, ${regularNightReadLabel(row.readAt)}`;
}

/** "7:30pm", the way a pub board says it. */
export function regularNightTimeLabel(time: string | null): string | null {
  const match = time ? /^(\d{2}):(\d{2})$/.exec(time) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "pm" : "am";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${twelve}${suffix}` : `${twelve}:${minute}${suffix}`;
}

/** The heading of the block, which says what it is before anything else. */
export const REGULAR_NIGHTS_HEADING = "Regular nights";

/** The line under it: not tonight's listing, and where the words come from. */
export function regularNightsLead(answer: Pick<RegularNightsAnswer, "weekdayLabel">): string {
  return `What runs on ${answer.weekdayLabel}s, per the pub’s site or its quiz host. Not tonight’s listing, so check before you go.`;
}
