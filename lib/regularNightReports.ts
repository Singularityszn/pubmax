// A regular night a drinker added: "there's a quiz here every Tuesday", with a
// photo of the board or the poster that says so.
//
// A REPORT IS NEVER A VENUE FACT AND NEVER TONIGHT'S LISTING. It is what one
// signed-in drinker saw on one day, so every row carries that day and prints
// apart from the sourced regular nights as "per a drinker, seen <date>", with
// the reporter's handle until a person confirms it. Nothing reads these rows to
// change a pack, a pin, hours or a price.
//
// IT EXPIRES. A report lives 90 days. A different signed-in account can say
// "still on" once, which moves the expiry 90 days on and makes the seen date
// that day. A hidden row and an expired row are never read.
//
// NO SCRAPING. A drinker types it and photographs it. Nothing here fetches.
//
// Browser-safe leaf: the form and the route share ONE validator, and the closed
// sets here are mirrored by CHECKs in migration 0206.

import { cleanText } from "@/lib/textClean";

export const REGULAR_NIGHT_REPORT_KINDS = ["quiz", "music", "sport", "comedy", "karaoke", "other"] as const;
export type RegularNightReportKind = (typeof REGULAR_NIGHT_REPORT_KINDS)[number];

const REGULAR_NIGHT_REPORT_STATUSES = ["open", "confirmed", "hidden"] as const;
export type RegularNightReportStatus = (typeof REGULAR_NIGHT_REPORT_STATUSES)[number];

/** A moderator's two verdicts. */
const REGULAR_NIGHT_REPORT_DECISIONS = ["confirmed", "hidden"] as const;
export type RegularNightReportDecision = (typeof REGULAR_NIGHT_REPORT_DECISIONS)[number];

/** 0 is Sunday, as `Date#getUTCDay` counts and as lib/regularNights.ts counts. */
export type RegularNightReportWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const REGULAR_NIGHT_REPORT_NOTE_MAX = 120;
const REGULAR_NIGHT_REPORT_TTL_DAYS = 90;
export const REGULAR_NIGHT_REPORT_TTL_MS = REGULAR_NIGHT_REPORT_TTL_DAYS * 24 * 60 * 60 * 1000;
const VENUE_ID_MAX = 128;
const START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** What the form offers, in the order it offers them. */
export const REGULAR_NIGHT_REPORT_KIND_CHOICES: ReadonlyArray<{ kind: RegularNightReportKind; label: string }> = [
  { kind: "quiz", label: "Pub quiz" },
  { kind: "music", label: "Live music" },
  { kind: "sport", label: "Sport on the screens" },
  { kind: "comedy", label: "Comedy" },
  { kind: "karaoke", label: "Karaoke" },
  { kind: "other", label: "Something else" },
];

export const REGULAR_NIGHT_REPORT_KIND_LABEL: Record<RegularNightReportKind, string> = {
  quiz: "Pub quiz",
  music: "Live music",
  sport: "Sport on the screens",
  comedy: "Comedy",
  karaoke: "Karaoke",
  other: "Something else",
};

/** Monday first, the way a pub board reads the week. Values are `getUTCDay` numbers. */
export const REGULAR_NIGHT_REPORT_WEEKDAY_CHOICES: ReadonlyArray<{ weekday: RegularNightReportWeekday; label: string }> = [
  { weekday: 1, label: "Monday" },
  { weekday: 2, label: "Tuesday" },
  { weekday: 3, label: "Wednesday" },
  { weekday: 4, label: "Thursday" },
  { weekday: 5, label: "Friday" },
  { weekday: 6, label: "Saturday" },
  { weekday: 0, label: "Sunday" },
];

export const REGULAR_NIGHT_REPORT_INVITE = "Know a regular night here? Add it";
export const REGULAR_NIGHT_REPORT_RECEIPT = "Thanks. It shows with your handle until a person confirms it.";
export const REGULAR_NIGHT_REPORT_SIGN_IN_LINE = "Sign in to contribute.";

export type RegularNightReport = {
  id: string;
  venueId: string;
  kind: RegularNightReportKind;
  weekday: RegularNightReportWeekday;
  /** "20:00", or null when the drinker gave no start. */
  startTime: string | null;
  note: string;
  /** Storage key of the board or poster photo. Never leaves the server but to a moderator, signed. */
  photoKey: string;
  reporterUserId: string;
  status: RegularNightReportStatus;
  createdAt: string;
  /** The report, or the latest "still on". The date a surface prints. */
  lastSeenAt: string;
  expiresAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
};

/** What the public read hands a surface. No account id and no photo key. */
export type PublicRegularNightReport = {
  id: string;
  venueId: string;
  venueName: string | null;
  kind: RegularNightReportKind;
  weekday: RegularNightReportWeekday;
  startTime: string | null;
  note: string;
  status: "open" | "confirmed";
  lastSeenAt: string;
  expiresAt: string;
  /** The reporter's current handle while the row is open; null once a person confirms it. */
  handle: string | null;
};

/** What a moderator reads beside each row. */
export type ModeratorRegularNightReport = {
  id: string;
  venueId: string;
  venueName: string | null;
  kind: RegularNightReportKind;
  weekday: RegularNightReportWeekday;
  startTime: string | null;
  note: string;
  status: RegularNightReportStatus;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** A short-lived signed URL for the board photo, or null when storage could not sign one. */
  photoUrl: string | null;
};

/** What the account export carries: the reporter's own fields, never the photo key. */
export type RegularNightReportOwnerFields = Pick<
  RegularNightReport,
  "id" | "venueId" | "kind" | "weekday" | "startTime" | "note" | "status" | "createdAt" | "lastSeenAt" | "expiresAt"
>;

export function regularNightReportOwnerFields(row: RegularNightReport): RegularNightReportOwnerFields {
  return {
    id: row.id,
    venueId: row.venueId,
    kind: row.kind,
    weekday: row.weekday,
    startTime: row.startTime,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
  };
}

export function isRegularNightReportKind(value: unknown): value is RegularNightReportKind {
  return typeof value === "string" && (REGULAR_NIGHT_REPORT_KINDS as readonly string[]).includes(value);
}

export function isRegularNightReportStatus(value: unknown): value is RegularNightReportStatus {
  return typeof value === "string" && (REGULAR_NIGHT_REPORT_STATUSES as readonly string[]).includes(value);
}

export function isRegularNightReportDecision(value: unknown): value is RegularNightReportDecision {
  return typeof value === "string" && (REGULAR_NIGHT_REPORT_DECISIONS as readonly string[]).includes(value);
}

/** A weekday as a number 0 to 6, or as the string a form field sends ("2"). */
export function readRegularNightWeekday(value: unknown): RegularNightReportWeekday | null {
  const raw = typeof value === "string" && /^\d$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 6
    ? (raw as RegularNightReportWeekday)
    : null;
}

/** Whether a row may be read at all: not hidden and not past its expiry. */
export function isLiveRegularNightReport(
  row: { status: string; expiresAt: string },
  now: number,
): boolean {
  if (row.status !== "open" && row.status !== "confirmed") return false;
  const expires = Date.parse(row.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

export type RegularNightReportInput = {
  venueId: string;
  kind: RegularNightReportKind;
  weekday: RegularNightReportWeekday;
  startTime: string | null;
  note: string;
};

export type RegularNightReportValidation =
  | ({ ok: true } & RegularNightReportInput)
  | { ok: false; field: "venueId" | "kind" | "weekday" | "startTime" | "note"; error: string };

/** The one validator, for the form and the route. Refuses rather than trims a long note. */
export function validateRegularNightReport(input: Record<string, unknown>): RegularNightReportValidation {
  const venueId = typeof input.venueId === "string" ? input.venueId.trim() : "";
  if (!venueId || venueId.length > VENUE_ID_MAX) {
    return { ok: false, field: "venueId", error: "Pick a pub from the map." };
  }
  if (!isRegularNightReportKind(input.kind)) {
    return { ok: false, field: "kind", error: "Choose what kind of night it is." };
  }
  const weekday = readRegularNightWeekday(input.weekday);
  if (weekday === null) {
    return { ok: false, field: "weekday", error: "Choose the night of the week." };
  }
  const rawTime = typeof input.startTime === "string" ? input.startTime.trim() : "";
  if (rawTime && !START_TIME.test(rawTime)) {
    return { ok: false, field: "startTime", error: "Give the start as a time, like 20:00." };
  }
  if (input.startTime !== undefined && input.startTime !== null && typeof input.startTime !== "string") {
    return { ok: false, field: "startTime", error: "Give the start as a time, like 20:00." };
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return { ok: false, field: "note", error: "The note must be text." };
  }
  const note = cleanText(input.note ?? "", REGULAR_NIGHT_REPORT_NOTE_MAX + 1);
  if (note.length > REGULAR_NIGHT_REPORT_NOTE_MAX) {
    return { ok: false, field: "note", error: `Keep the note to ${REGULAR_NIGHT_REPORT_NOTE_MAX} characters.` };
  }
  return { ok: true, venueId, kind: input.kind, weekday, startTime: rawTime || null, note };
}

/** Bucket folder for one account's board photos. Account deletion walks it. */
const REGULAR_NIGHT_BOARD_STORAGE_PREFIX = "regular-night-boards";

export function regularNightBoardObjectPrefix(reporterUserId: string): string {
  return `${REGULAR_NIGHT_BOARD_STORAGE_PREFIX}/${reporterUserId}`;
}

/** The one shape a board photo's key takes; the 0206 CHECK holds it. */
export function regularNightBoardKey(reporterUserId: string, reportId: string): string {
  return `${regularNightBoardObjectPrefix(reporterUserId)}/${reportId}.jpg`;
}
