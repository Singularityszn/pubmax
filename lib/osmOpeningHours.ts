// The one reader of the OSM opening_hours syntax. `/near` desks decide open
// state with it, and the pub sheets print the days it states. It reads a
// narrow grammar on purpose: a string it cannot read is never guessed at.

import type { WeeklyOpeningHours } from "@/lib/busyness";

const DAY_TOKEN = /^(Mo|Tu|We|Th|Fr|Sa|Su)$/;
const DAY_INDEX: Record<string, number> = {
  Su: 0,
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
};

function expandDayToken(token: string): number[] {
  const [from = "", to = "", ...extra] = token.split("-");
  if (extra.length === 0 && DAY_TOKEN.test(from) && DAY_TOKEN.test(to)) {
    const start = DAY_INDEX[from];
    const end = DAY_INDEX[to];
    if (start === undefined || end === undefined) return [];
    const days: number[] = [];
    let day = start;
    for (let i = 0; i < 7; i += 1) {
      days.push(day);
      if (day === end) break;
      day = (day + 1) % 7;
    }
    return days;
  }
  if (DAY_TOKEN.test(token)) {
    const day = DAY_INDEX[token];
    return day === undefined ? [] : [day];
  }
  return [];
}

// One token it cannot read empties the whole list. `Su,PH 12:00-19:00` must
// not become a Sunday-only rule that hides the public-holiday hours.
function parseDayList(raw: string): number[] {
  const days = new Set<number>();
  for (const token of raw.split(/\s*,\s*/)) {
    const expanded = expandDayToken(token.trim());
    if (expanded.length === 0) return [];
    for (const day of expanded) days.add(day);
  }
  return [...days];
}

function parseTimeWindows(raw: string): { opens: string; closes: string }[] {
  const windows: { opens: string; closes: string }[] = [];
  for (const part of raw.split(/\s*,\s*/)) {
    const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|24:00)$/.exec(part.trim());
    if (!match) return [];
    windows.push({
      opens: (match[1] ?? "").padStart(5, "0"),
      closes: match[2] === "24:00" ? "24:00" : (match[2] ?? "").padStart(5, "0"),
    });
  }
  return windows;
}

function splitHourRules(input: string): string[] {
  const rules: string[] = [];
  for (const semi of input.split(/\s*;\s*/)) {
    const chunk = semi.trim();
    if (!chunk) continue;
    let buffer = "";
    for (const piece of chunk.split(/\s*,\s*/)) {
      if (!buffer) {
        buffer = piece;
        continue;
      }
      const bufferHasTime = /\d{1,2}:\d{2}/.test(buffer);
      const pieceHasDay = /^(Mo|Tu|We|Th|Fr|Sa|Su|PH|24\/7)\b/.test(piece);
      if (bufferHasTime && pieceHasDay) {
        rules.push(buffer);
        buffer = piece;
      } else {
        buffer += `, ${piece}`;
      }
    }
    if (buffer) rules.push(buffer);
  }
  return rules;
}

function applyWindows(
  hours: WeeklyOpeningHours,
  days: number[],
  windows: { opens: string; closes: string }[],
): void {
  for (const day of days) {
    hours[day] = [...windows];
  }
}

/**
 * The days an OSM opening_hours string states, and nothing else. Common day
 * ranges, clock windows, `24/7` and `<days> off` are read. Any other rule
 * (a public holiday, a month, a comment) makes the whole string unread, so a
 * reader shows it raw or not at all rather than a guessed door.
 *
 * Later rules OVERRIDE earlier ones for the same day. OSM writes
 * `Mo-Su 08:00-22:00; Su 10:00-18:00` to narrow Sunday, not to union both
 * windows. A day no rule mentions is absent here: `parseOsmOpeningHours`
 * decides what that means for open state.
 */
export function readOsmOpeningHours(
  raw: string | null | undefined,
): WeeklyOpeningHours | null {
  if (typeof raw !== "string") return null;
  const source = raw.trim();
  if (!source) return null;
  if (/^24\/7$/i.test(source)) {
    const hours: WeeklyOpeningHours = {};
    for (let day = 0; day < 7; day += 1) {
      hours[day] = [{ opens: "00:00", closes: "24:00" }];
    }
    return hours;
  }

  const hours: WeeklyOpeningHours = {};
  let parsed = false;
  for (const rule of splitHourRules(source)) {
    if (/^24\/7$/i.test(rule)) {
      for (let day = 0; day < 7; day += 1) {
        hours[day] = [{ opens: "00:00", closes: "24:00" }];
      }
      parsed = true;
      continue;
    }
    const off = /^(.*?)\s+off$/i.exec(rule);
    if (off) {
      const days = parseDayList(off[1] ?? "");
      if (days.length === 0) return null;
      for (const day of days) hours[day] = [];
      parsed = true;
      continue;
    }
    const match = /^(.*?)\s+(\d{1,2}:\d{2}\s*-\s*(?:\d{1,2}:\d{2}|24:00)(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*(?:\d{1,2}:\d{2}|24:00))*)$/.exec(rule);
    if (!match) return null;
    const days = parseDayList(match[1] ?? "");
    const windows = parseTimeWindows(match[2] ?? "");
    if (days.length === 0 || windows.length === 0) return null;
    applyWindows(hours, days, windows);
    parsed = true;
  }
  return parsed ? hours : null;
}

/**
 * A conservative OSM opening_hours reader for open state. Common day ranges
 * and clock windows become weekly hours. Anything else stays unknown rather
 * than a guessed door.
 *
 * Later rules OVERRIDE earlier ones for the same day. A day no rule mentions
 * is CLOSED, not unknown, because that is what the OSM syntax states.
 */
export function parseOsmOpeningHours(
  raw: string | null | undefined,
): WeeklyOpeningHours | null {
  const hours = readOsmOpeningHours(raw);
  if (!hours) return null;
  for (let day = 0; day < 7; day += 1) {
    if (!hours[day]) hours[day] = [];
  }
  return hours;
}
