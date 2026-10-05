/**
 * How a thread reads as a conversation rather than a list of rows.
 *
 * Pure, and a LEAF: the thread and the inbox both mount in browser bundles
 * that must not drag the venue index behind one date. Everything here is a
 * function of the rows the API answered plus one `now`, so a test can hold a
 * whole evening still.
 *
 * FOUR readings, and only these. (1) A DAY LINE sits between two messages on
 * different London days, worded the way a person says it: Today, Yesterday,
 * the weekday inside a week, then the date. (2) A RUN is one person talking
 * without a reply and without a long pause, so consecutive bubbles in a run
 * sit tight and share a straight shoulder; the time and the read state print
 * ONCE, under the last bubble of the run, never under every bubble. (3) A READ
 * STATE is only ever claimed about the viewer's OWN newest message, and it says
 * one of two things the row can prove: Seen, when the other participant's read
 * of it is recorded, or Sent. Nothing here says Delivered, because nothing in
 * the store knows a device. (4) An INBOX TIME is compact and relative, because
 * a list row has one line to spend on it.
 */

import { LONDON_DAY_MS } from "@/lib/londonHour";
import type { MessageDTO } from "@/lib/messages";

/** A pause long enough that the next bubble opens a new run. */
export const MESSAGE_RUN_GAP_MS = 10 * 60 * 1000;

/** Under a week the inbox names the weekday; from a week on, the date. */
const WEEK_MS = 7 * LONDON_DAY_MS;

let dayKeyFormatter: Intl.DateTimeFormat | null = null;
let clockFormatter: Intl.DateTimeFormat | null = null;
let weekdayFormatter: Intl.DateTimeFormat | null = null;
let weekdayShortFormatter: Intl.DateTimeFormat | null = null;
let dateFormatter: Intl.DateTimeFormat | null = null;
let dateWithYearFormatter: Intl.DateTimeFormat | null = null;

function londonDayKeyFormatter(): Intl.DateTimeFormat {
  dayKeyFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dayKeyFormatter;
}

function londonClock(): Intl.DateTimeFormat {
  clockFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return clockFormatter;
}

function londonWeekday(short: boolean): Intl.DateTimeFormat {
  if (short) {
    weekdayShortFormatter ??= new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
    });
    return weekdayShortFormatter;
  }
  weekdayFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
  });
  return weekdayFormatter;
}

function londonDate(withYear: boolean): Intl.DateTimeFormat {
  if (withYear) {
    dateWithYearFormatter ??= new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return dateWithYearFormatter;
  }
  dateFormatter ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
  });
  return dateFormatter;
}

function parseIso(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** `YYYY-MM-DD` in London, or "" for a date that does not parse. */
export function messageDayKey(iso: string): string {
  const date = parseIso(iso);
  return date ? londonDayKeyFormatter().format(date) : "";
}

/** "19:42" in London, or "" for a date that does not parse. */
export function messageClock(iso: string): string {
  const date = parseIso(iso);
  if (!date) return "";
  // Some ICU builds print midnight as 24:00.
  return londonClock().format(date).replace(/^24:/, "00:");
}

/**
 * How many London days separate two instants, by their day keys rather than
 * by dividing milliseconds, so a message at 23:50 and one at 00:10 are one day
 * apart whatever the clocks did in between.
 */
function londonDaysBetween(earlier: Date, later: Date): number {
  const keyOf = (date: Date) => londonDayKeyFormatter().format(date);
  const earlierKey = keyOf(earlier);
  const laterKey = keyOf(later);
  if (earlierKey === laterKey) return 0;
  // Keys are ISO dates, so a UTC parse of each gives a day count exactly.
  const earlierDay = Date.UTC(
    Number(earlierKey.slice(0, 4)),
    Number(earlierKey.slice(5, 7)) - 1,
    Number(earlierKey.slice(8, 10)),
  );
  const laterDay = Date.UTC(
    Number(laterKey.slice(0, 4)),
    Number(laterKey.slice(5, 7)) - 1,
    Number(laterKey.slice(8, 10)),
  );
  return Math.round((laterDay - earlierDay) / LONDON_DAY_MS);
}

/**
 * The day line: Today, Yesterday, a weekday inside the last week, then the
 * date, with the year only once it is not this year.
 */
export function messageDayLabel(iso: string, now: Date = new Date()): string {
  const date = parseIso(iso);
  if (!date) return "";
  const days = londonDaysBetween(date, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return londonWeekday(false).format(date);
  const sameYear =
    messageDayKey(iso).slice(0, 4) === londonDayKeyFormatter().format(now).slice(0, 4);
  return londonDate(!sameYear).format(date);
}

/**
 * The inbox row's time. Compact because it shares a line with the unread mark:
 * "now" under a minute, minutes under an hour, hours inside today, the weekday
 * inside a week, then the date.
 */
export function inboxTimeLabel(iso: string, now: Date = new Date()): string {
  const date = parseIso(iso);
  if (!date) return "";
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < 60_000) return "now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m`;
  const days = londonDaysBetween(date, now);
  if (days <= 0) return `${Math.floor(elapsed / (60 * 60_000))}h`;
  if (days === 1) return "Yesterday";
  if (elapsed < WEEK_MS) return londonWeekday(true).format(date);
  const sameYear =
    messageDayKey(iso).slice(0, 4) === londonDayKeyFormatter().format(now).slice(0, 4);
  return londonDate(!sameYear).format(date);
}

/** The one letter a face is drawn from when no photo is held. */
export function handleMonogram(handle: string): string {
  const letter = handle.trim().replace(/^@/, "").charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

export type MessageReadState = "seen" | "sent";

/** What the row can prove about the viewer's own newest message. */
export function messageReadState(message: Pick<MessageDTO, "read">): MessageReadState {
  return message.read ? "seen" : "sent";
}

export const MESSAGE_READ_STATE_LABEL: Record<MessageReadState, string> = {
  seen: "Seen",
  sent: "Sent",
};

type TimelineDay = { kind: "day"; key: string; label: string };

type TimelineMessage = {
  kind: "message";
  message: MessageDTO;
  mine: boolean;
  /** Opens a run: the bubble above belongs to somebody else, or to another moment. */
  first: boolean;
  /** Closes a run: the bubble below belongs to somebody else, or to another moment. */
  last: boolean;
  /** The time under this bubble, printed only where `last` is true. */
  clock: string;
  /** Present on the viewer's own newest message alone. */
  readState: MessageReadState | null;
};

export type TimelineItem = TimelineDay | TimelineMessage;

function sameRun(previous: MessageDTO, next: MessageDTO): boolean {
  if (previous.senderHandle !== next.senderHandle) return false;
  const gap = new Date(next.createdAt).getTime() - new Date(previous.createdAt).getTime();
  if (!Number.isFinite(gap) || gap < 0 || gap > MESSAGE_RUN_GAP_MS) return false;
  return messageDayKey(previous.createdAt) === messageDayKey(next.createdAt);
}

/**
 * Rows in reading order, with day lines between days and every bubble told
 * where it sits in its run. The viewer's own NEWEST message carries the read
 * state; no other bubble does.
 */
export function buildMessageTimeline(
  messages: readonly MessageDTO[],
  viewerHandle: string,
  now: Date = new Date(),
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let lastOwnIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.senderHandle === viewerHandle) {
      lastOwnIndex = index;
      break;
    }
  }
  let previousDay = "";
  messages.forEach((message, index) => {
    const day = messageDayKey(message.createdAt);
    if (day && day !== previousDay) {
      items.push({ kind: "day", key: day, label: messageDayLabel(message.createdAt, now) });
      previousDay = day;
    }
    const before = messages[index - 1] ?? null;
    const after = messages[index + 1] ?? null;
    const mine = message.senderHandle === viewerHandle;
    items.push({
      kind: "message",
      message,
      mine,
      first: !before || !sameRun(before, message),
      last: !after || !sameRun(message, after),
      clock: messageClock(message.createdAt),
      readState: mine && index === lastOwnIndex ? messageReadState(message) : null,
    });
  });
  return items;
}
