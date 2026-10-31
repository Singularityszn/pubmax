// A CRAWL OTHER PEOPLE CAN FIND (launch review 4.5, E1 and E2).
//
// E1, "Open it up": a host turns a locked plan into an Open Crew that CARRIES
// the plan. It is not a second crew: `social_crews` is already bound one to one
// to a plan (0075), so the crew carries the plan id, the ordered stops and the
// start time by construction. Migration 0208 adds the three things a stranger
// needs to decide: a capacity, a meeting pub that is one of the plan's own
// stops, and one line from the host.
//
// E2, "Host this on a date": a fixed route or a crawl story becomes a plan
// through the planner's own create door, with the stops in the story's order.
// No model is called.
//
// This module is a pure leaf: the rules and the words, no fetch and no store,
// so the route, the store, the client and the tests read one answer.

import { CREW_MAX_MEMBERS } from "@/lib/crew";
import { PLAN_STOP_MAX } from "@/lib/plan";
import { londonDateTimeInputToIso } from "@/lib/planIntake";

/** The smallest open crawl worth listing for strangers. */
export const OPEN_CRAWL_CAPACITY_MIN = 4;
/** The existing crew cap, never a second number for one idea. */
export const OPEN_CRAWL_CAPACITY_MAX = CREW_MAX_MEMBERS;
export const OPEN_CRAWL_CAPACITY_DEFAULT = 8;
export const OPEN_CRAWL_DESCRIPTION_MAX = 140;
/** "Crawls you can join this week" looks this far ahead. */
const OPEN_CRAWL_JOIN_WINDOW_DAYS = 7;
export const OPEN_CRAWL_LIST_LIMIT = 20;
/** "Host this on a date" offers today to this many days ahead. */
const HOST_ON_DATE_MAX_DAYS = 60;
export const HOST_ON_DATE_DEFAULT_TIME = "19:00";

const DAY_MS = 24 * 60 * 60 * 1000;

export const OPEN_CRAWL_CAPACITY_LINE =
  `Pick a crew size between ${OPEN_CRAWL_CAPACITY_MIN} and ${OPEN_CRAWL_CAPACITY_MAX}.`;
export const OPEN_CRAWL_MEETING_LINE = "Meet at one of the plan's own pubs.";
const OPEN_CRAWL_DESCRIPTION_EMPTY_LINE = "Add one line so people know what the night is.";
export const OPEN_CRAWL_DESCRIPTION_LONG_LINE =
  `Keep it to one line, ${OPEN_CRAWL_DESCRIPTION_MAX} characters at most.`;
export const OPEN_CRAWL_DESCRIPTION_CONTACT_LINE =
  "Leave out links, numbers and email addresses. People ask to join here.";
export const OPEN_CRAWL_DESCRIPTION_WORD_LINE =
  "Say what the night is, not how much gets drunk.";
/** What the host is told before the plan moves. */
export const OPEN_CRAWL_MOVE_NOTE =
  "Your plan moves to a crew page anyone can find. The old invite link stops working, and people ask to join there. You say yes or no.";
export const OPEN_CRAWL_SIGNED_OUT_LINE = "Sign in to open this plan up to people you have not met yet.";
export const OPEN_CRAWL_EMPTY_LINE =
  "No open crawls this week yet. Host one from a route below and it shows up here.";
export const OPEN_CRAWL_UNREAD_LINE = "We couldn't check open crawls just now.";
export const HOST_ON_DATE_SIGNED_OUT_LINE = "Sign in to host this crawl on a date.";
export const HOST_ON_DATE_RANGE_LINE =
  `Pick a time from now to ${HOST_ON_DATE_MAX_DAYS} days ahead.`;
export const HOST_ON_DATE_NO_HANDLE_LINE = "A host needs a handle people can see.";
export const HOST_ON_DATE_NO_STOPS_LINE = "This crawl has no listed pubs to plan.";

/**
 * Words a stranger-facing line may not use. They sell quantity, and the house
 * voice bans the first three for the same reason (docs/VOICE.md, the Pal
 * copy test). Matched as whole words, case-insensitive.
 */
const OPEN_CRAWL_REFUSED_WORDS = [
  "carnage",
  "sesh",
  "session",
  "wasted",
  "smashed",
  "hammered",
  "blackout",
  "bottomless",
] as const;

const LINK_RE = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|co\.uk|uk|net|org|io|me|ly|gg|app)\b)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const HANDLE_AT_RE = /(?:^|\s)@[a-z0-9_.]{2,}/i;

export type OpenCrawlDescriptionResult =
  | { ok: true; text: string }
  | { ok: false; line: string };

function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function digitCount(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/**
 * The host's one line, checked before it reaches a stranger. It is one line,
 * 140 characters at most, carries no way to be reached off the app (a link, an
 * email address, a phone number or another handle), and none of the words that
 * sell quantity.
 */
export function checkOpenCrawlDescription(value: unknown): OpenCrawlDescriptionResult {
  const text = cleanLine(value);
  if (!text) return { ok: false, line: OPEN_CRAWL_DESCRIPTION_EMPTY_LINE };
  if ([...text].length > OPEN_CRAWL_DESCRIPTION_MAX) {
    return { ok: false, line: OPEN_CRAWL_DESCRIPTION_LONG_LINE };
  }
  if (LINK_RE.test(text) || EMAIL_RE.test(text) || HANDLE_AT_RE.test(text) || digitCount(text) >= 9) {
    return { ok: false, line: OPEN_CRAWL_DESCRIPTION_CONTACT_LINE };
  }
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.some((word) => (OPEN_CRAWL_REFUSED_WORDS as readonly string[]).includes(word))) {
    return { ok: false, line: OPEN_CRAWL_DESCRIPTION_WORD_LINE };
  }
  return { ok: true, text };
}

function isOpenCrawlCapacity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= OPEN_CRAWL_CAPACITY_MIN &&
    value <= OPEN_CRAWL_CAPACITY_MAX
  );
}

export type OpenCrawlStop = { venueId: string; venueName: string; position: number };

type OpenCrawlInput = {
  capacity: number;
  meetingVenueId: string;
  description: string;
};

export type OpenCrawlInputResult =
  | { ok: true; value: OpenCrawlInput }
  | { ok: false; field: "capacity" | "meetingVenueId" | "description"; line: string };

/**
 * The host's three answers against the plan's own stops. The meeting pub must
 * be one of them: a stranger is never sent somewhere the plan does not go.
 */
export function validateOpenCrawlInput(
  body: { capacity?: unknown; meetingVenueId?: unknown; description?: unknown },
  stops: readonly OpenCrawlStop[],
): OpenCrawlInputResult {
  if (!isOpenCrawlCapacity(body.capacity)) {
    return { ok: false, field: "capacity", line: OPEN_CRAWL_CAPACITY_LINE };
  }
  const meetingVenueId = typeof body.meetingVenueId === "string" ? body.meetingVenueId.trim() : "";
  if (!meetingVenueId || !stops.some((stop) => stop.venueId === meetingVenueId)) {
    return { ok: false, field: "meetingVenueId", line: OPEN_CRAWL_MEETING_LINE };
  }
  const description = checkOpenCrawlDescription(body.description);
  if (!description.ok) return { ok: false, field: "description", line: description.line };
  return {
    ok: true,
    value: { capacity: body.capacity, meetingVenueId, description: description.text },
  };
}

/** The meeting pub a host is offered first: Stop 1. */
export function defaultMeetingVenueId(stops: readonly OpenCrawlStop[]): string | null {
  const first = [...stops].sort((left, right) => left.position - right.position)[0];
  return first?.venueId ?? null;
}

/** What a member reads about an open crawl, beside the plan the crew carries. */
export type OpenCrawlDetails = {
  capacity: number;
  meetingVenueId: string;
  meetingVenueName: string;
  description: string;
};

export function parseOpenCrawlDetails(value: unknown): OpenCrawlDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !isOpenCrawlCapacity(row.capacity) ||
    typeof row.meetingVenueId !== "string" ||
    !row.meetingVenueId.trim() ||
    typeof row.meetingVenueName !== "string" ||
    !row.meetingVenueName.trim() ||
    typeof row.description !== "string" ||
    !row.description.trim()
  ) {
    return null;
  }
  return {
    capacity: row.capacity,
    meetingVenueId: row.meetingVenueId,
    meetingVenueName: row.meetingVenueName,
    description: row.description,
  };
}

/** One row of "Crawls you can join this week". */
export type OpenCrawlListing = OpenCrawlDetails & {
  crewId: string;
  title: string;
  startTime: string;
  hostHandle: string;
  memberCount: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseOpenCrawlListing(value: unknown): OpenCrawlListing | null {
  const details = parseOpenCrawlDetails(value);
  if (!details) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.crewId !== "string" ||
    !UUID_RE.test(row.crewId) ||
    typeof row.title !== "string" ||
    !row.title.trim() ||
    typeof row.startTime !== "string" ||
    !Number.isFinite(Date.parse(row.startTime)) ||
    typeof row.hostHandle !== "string" ||
    !row.hostHandle.trim() ||
    !Number.isInteger(row.memberCount) ||
    Number(row.memberCount) < 0
  ) {
    return null;
  }
  return {
    ...details,
    crewId: row.crewId,
    title: row.title,
    startTime: row.startTime,
    hostHandle: row.hostHandle,
    memberCount: Number(row.memberCount),
  };
}

/** Places still open. Never below zero, and a count we cannot read is no place. */
export function openCrawlPlacesLeft(row: Pick<OpenCrawlListing, "capacity" | "memberCount">): number {
  return Math.max(0, row.capacity - row.memberCount);
}

export function openCrawlPlacesLine(left: number): string {
  return left === 1 ? "1 place left" : `${left} places left`;
}

/** The window the list asks the store for: from now to seven days ahead. */
export function openCrawlJoinWindow(now: number): { from: string; until: string } {
  return {
    from: new Date(now).toISOString(),
    until: new Date(now + OPEN_CRAWL_JOIN_WINDOW_DAYS * DAY_MS).toISOString(),
  };
}

/**
 * The rows "Crawls you can join this week" prints: a start inside the next
 * seven days, at least one place left, soonest first. The database already
 * narrows the window; this is the same rule again at the edge, so a row that
 * filled up or slipped out between the read and the render is not offered.
 */
export function joinableThisWeek(
  rows: readonly OpenCrawlListing[],
  now: number,
): OpenCrawlListing[] {
  const until = now + OPEN_CRAWL_JOIN_WINDOW_DAYS * DAY_MS;
  return rows
    .filter((row) => {
      const start = Date.parse(row.startTime);
      return Number.isFinite(start) && start >= now && start < until && openCrawlPlacesLeft(row) > 0;
    })
    .sort((left, right) =>
      Date.parse(left.startTime) - Date.parse(right.startTime) || left.crewId.localeCompare(right.crewId),
    );
}

// --- E2, Host this on a date ---------------------------------------------

/** A stop as a story or a fixed route carries it. */
export type StoryStopInput = { venueId?: string | null; venueName?: string | null };

/**
 * The plan's stops, in the story's own order. A stop with no listed venue id
 * cannot be planned and is left out; a pub that appears twice is kept at its
 * first place; and the plan's own cap applies. Nothing is reordered.
 */
export function planStopsFromStory(
  stops: readonly StoryStopInput[],
): { venueId: string; venueName: string }[] {
  const seen = new Set<string>();
  const out: { venueId: string; venueName: string }[] = [];
  for (const stop of stops) {
    const venueId = typeof stop.venueId === "string" ? stop.venueId.trim() : "";
    const venueName = typeof stop.venueName === "string" ? stop.venueName.trim() : "";
    if (!venueId || !venueName || seen.has(venueId)) continue;
    seen.add(venueId);
    out.push({ venueId, venueName });
    if (out.length === PLAN_STOP_MAX) break;
  }
  return out;
}

function londonDateParts(now: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The date picker's bounds, as London calendar days. */
export function hostOnDateBounds(now: number): { min: string; max: string } {
  return {
    min: londonDateParts(now),
    max: londonDateParts(now + HOST_ON_DATE_MAX_DAYS * DAY_MS),
  };
}

/**
 * A London date and time as the instant a plan starts, or null when it has
 * already passed or sits past the 60-day horizon.
 */
export function hostOnDateStartIso(date: string, time: string, now: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const { min, max } = hostOnDateBounds(now);
  if (date < min || date > max) return null;
  const iso = londonDateTimeInputToIso(`${date}T${time}`, new Date(now));
  if (!iso) return null;
  const start = Date.parse(iso);
  return start > now ? iso : null;
}

export type HostOnDateInput = {
  title: string;
  creatorName: string;
  startIso: string;
  stops: readonly StoryStopInput[];
};

/**
 * The body the planner's create door (`POST /api/plans`) reads. It is the same
 * shape the crew composer sends (`startCrewPlanBody`), with every stop.
 */
export function hostOnDatePlanBody(input: HostOnDateInput): Record<string, unknown> | null {
  const stops = planStopsFromStory(input.stops);
  const creatorName = input.creatorName.trim().slice(0, 40);
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!stops.length || !creatorName || !Number.isFinite(Date.parse(input.startIso))) return null;
  return {
    title: title || "Tonight's Plan",
    startTime: new Date(Date.parse(input.startIso)).toISOString(),
    creatorName,
    stops,
  };
}
