// Night falls (wild idea 09): the pure half. When the moment plays, which
// night it belongs to, where the lamps bloom and what the toast says.
//
// The app already turns dark at 21:30 London time for a reader with no stored
// theme choice (lib/themePreference.ts, public/theme-init.js,
// components/ThemeAttribute.tsx), and marks that page html[data-night-theme].
// This module only decides when to make that switch a moment, once a night in
// this browser; it never decides the theme itself.

import { isNightThemeTime } from "@/lib/themePreference";

/** The browser remembers the last night the moment played. */
export const NIGHT_FALL_STORAGE_KEY = "pubmax-wild-nightfall";
/** `?nightfall=now` plays it on demand (only while the wild switch is on). */
export const NIGHT_FALL_PARAM = "nightfall";

/** The whole moment, blooms to fade, in milliseconds. */
export const NIGHT_FALL_MS = 2500;

/**
 * The toast. It says what really changed: the night rule darkens the pages
 * and the map, and lifts at 04:00 (lib/themePreference.ts). Type and buttons
 * are theme-invariant in this app (app/theme.css: "Dark mode changes
 * contrast, never scale or weight"), so the toast does not promise bigger
 * buttons.
 */
export const NIGHT_FALL_TOAST = {
  time: "21:30",
  text: "Night mode: a darker map until 04:00.",
} as const;

const LONDON = "Europe/London";

function londonParts(now: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour") };
}

/**
 * The night `now` belongs to, as the London date its evening began
 * ("2026-11-02" from 21:30 on 2 November until 03:59 on the 3rd), or null
 * outside the night rule's hours.
 */
export function nightFallKey(now: Date): string | null {
  if (!isNightThemeTime(now)) return null;
  const { year, month, day, hour } = londonParts(now);
  // After midnight the night still belongs to the evening before.
  const evening = new Date(Date.UTC(year, month - 1, hour < 4 ? day - 1 : day));
  return evening.toISOString().slice(0, 10);
}

/**
 * Whether the moment plays now, and under which night's key. It plays when the
 * NIGHT RULE has made the page dark (html[data-night-theme="1"] on a dark
 * page, never a reader's own dark choice) and this browser has not seen it
 * tonight. It covers both ways in: the rule turning an open page dark at
 * 21:30, and the first page load later that night.
 */
export function nightFallDue(input: {
  nightTheme: boolean;
  theme: string | undefined;
  lastPlayedKey: string | null;
  now: Date;
}): string | null {
  if (!input.nightTheme || input.theme !== "dark") return null;
  const key = nightFallKey(input.now);
  if (!key || key === input.lastPlayedKey) return null;
  return key;
}

/** One lamp: where it blooms, how wide, and when. */
export type NightFallLamp = { x: number; y: number; size: number; delayMs: number };

/** A small, seeded generator, so the same screen gets the same street of lamps. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Where the lamps bloom: a jittered grid across the screen, lit one after
 * another in a sweep from the top left, like a lamplighter going down a street.
 * A lamp never blooms on a price: any spot within reach of a painted pin
 * (`avoid`, the map's painted-pin probe) is left dark.
 */
export function nightFallLamps(
  width: number,
  height: number,
  avoid: readonly { x: number; y: number }[] = [],
  seed = 2130,
): NightFallLamp[] {
  if (width <= 0 || height <= 0) return [];
  const random = seeded(seed);
  const columns = width < 641 ? 3 : 5;
  const rows = height < 700 ? 4 : 5;
  const cellW = width / columns;
  const cellH = height / rows;
  const spots: Omit<NightFallLamp, "delayMs">[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = cellW * (column + 0.2 + random() * 0.6);
      const y = cellH * (row + 0.2 + random() * 0.6);
      if (avoid.some((point) => Math.hypot(point.x - x, point.y - y) < 64)) continue;
      const size = Math.round(Math.min(cellW, cellH) * (0.9 + random() * 0.5));
      spots.push({ x: Math.round(x), y: Math.round(y), size });
    }
  }
  spots.sort((a, b) => a.x + a.y * 0.7 - (b.x + b.y * 0.7));
  const stagger = spots.length > 1 ? Math.min(110, 1100 / (spots.length - 1)) : 0;
  return spots.map((spot, index) => ({ ...spot, delayMs: Math.round(120 + index * stagger) }));
}
