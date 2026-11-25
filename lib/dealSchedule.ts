import { londonDayKey, londonMsSinceMidnight } from "@/lib/londonHour";

export type DealSchedule = { days: number[]; start: string; end: string };

const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minuteOfDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

export function parseDealSchedule(value: unknown): DealSchedule | null {
  if (!value || typeof value !== "object") return null;
  const { days, start, end } = value as Record<string, unknown>;
  if (!Array.isArray(days) || !days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
  const startMinute = minuteOfDay(start);
  const endMinute = minuteOfDay(end);
  if (startMinute === null || endMinute === null || startMinute === endMinute) return null;
  return { days: [...new Set(days)].sort((a, b) => a - b), start: start as string, end: end as string };
}

export function dealIsOn(schedule: DealSchedule, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const start = minuteOfDay(schedule.start);
  const end = minuteOfDay(schedule.end);
  if (start === null || end === null || start === end) return false;
  const day = weekdays.indexOf(weekday.format(now));
  const minute = Math.floor(londonMsSinceMidnight(now) / 60000);
  if (start < end) return schedule.days.includes(day) && minute >= start && minute < end;
  return (schedule.days.includes(day) && minute >= start)
    || (schedule.days.includes((day + 6) % 7) && minute < end);
}

export function dealIsVisible(deal: { endDate: string | null }, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  return deal.endDate === null || deal.endDate >= londonDayKey(now);
}

export function dealAvailableNow(
  deal: { schedule: DealSchedule; endDate: string | null; reportedAt: string },
  now: Date,
): boolean {
  if (!dealIsVisible(deal, now) || !dealIsOn(deal.schedule, now)) return false;
  const reported = Date.parse(deal.reportedAt);
  if (!Number.isFinite(reported) || reported > now.getTime()) return false;
  return now.getTime() - reported <= 30 * 24 * 60 * 60 * 1000;
}

export function nextLondonMidnight(now: number): number {
  const today = londonDayKey(now);
  let low = now;
  let high = now + 27 * 60 * 60 * 1000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (londonDayKey(mid) === today) low = mid;
    else high = mid;
  }
  return high;
}
