/**
 * Opening hours we derived for the Shoreditch coffee box. The file holds our
 * weekly windows, never Google's hours sentences.
 */

import type { WeeklyOpeningHours } from "@/lib/busyness";
import cafes from "@/data/places_verification/shoreditch_cafes.json";

function isClock(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24) return minute === 0;
  return hour <= 23 && minute <= 59;
}

function isWeeklyHours(value: unknown): value is WeeklyOpeningHours {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  for (const [key, windows] of entries) {
    if (!/^[0-6]$/.test(key) || !Array.isArray(windows)) return false;
    for (const window of windows) {
      if (typeof window !== "object" || window === null) return false;
      const opens = (window as { opens?: unknown }).opens;
      const closes = (window as { closes?: unknown }).closes;
      if (typeof opens !== "string" || typeof closes !== "string") return false;
      if (!isClock(opens) || !isClock(closes)) return false;
    }
  }
  return true;
}

function hoursByVenue(value: unknown): ReadonlyMap<string, WeeklyOpeningHours> {
  const rows = (value as { rows?: unknown } | null)?.rows;
  const byId = new Map<string, WeeklyOpeningHours>();
  if (!Array.isArray(rows)) return byId;
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as { venueId?: unknown; openingHours?: unknown; closedPermanently?: unknown };
    if (typeof record.venueId !== "string" || record.closedPermanently === true) continue;
    if (!isWeeklyHours(record.openingHours)) continue;
    byId.set(record.venueId, record.openingHours);
  }
  return byId;
}

export const VERIFIED_CAFE_HOURS: ReadonlyMap<string, WeeklyOpeningHours> = hoursByVenue(cafes);

export function applyVerifiedCafeHours<T extends { id: string; openingHours: WeeklyOpeningHours | null }>(
  venues: readonly T[],
  hoursById: ReadonlyMap<string, WeeklyOpeningHours> = VERIFIED_CAFE_HOURS,
): T[] {
  if (hoursById.size === 0) return [...venues];
  return venues.map((venue) => {
    const hours = hoursById.get(venue.id);
    if (!hours) return venue;
    return { ...venue, openingHours: hours };
  });
}
