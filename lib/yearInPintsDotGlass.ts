// The Year in Pints as a dot picture: a pint glass of days, filled with nights.
//
// THREE RULES.
//
// (1) THE GLASS DRAWS ONLY A NUMBER THE PERSON TICKED. A shared year carries
//     counts and nothing about where or when (lib/yearInPints.ts), so the glass
//     is a tally and never a map or a calendar. It is drawn only when the
//     "nights" line was ticked, and it reads that count and the month the year
//     was read to, nothing else.
//
// (2) EVERY DOT IS A DAY OF THAT YEAR. The glass holds exactly as many dots as
//     the year has days. Counting up from the bottom, the first dots are lit,
//     one per night out; the next are dim, the rest of the days read so far;
//     the top is faint, the days still to come. A lit dot is never placed on a
//     date, because the link does not say which days they were.
//
// (3) A YEAR READ BACK IS NOT A SCORE. The lit dots are amber, the lager
//     gold, never coral, the same way the card's counts are ink
//     (app/api/year-card/route.tsx). The page paints them from `--amber`, not
//     `--night-amber`, because the light theme's `--night-amber` IS coral.
//
// This module is the layout only, so a page and a share card draw the same
// glass: the card paints it in lib/yearInPintsDotGlassOg.tsx, the shared page
// in app/year-in-pints/[year]/YearGlass.tsx. The pint's outline is
// lib/dotGlass.ts, shared with the empty and spilled glasses.

import { glassCapacity, glassPoints } from "@/lib/dotGlass";

export type GlassTone = "night" | "day" | "ahead";
type GlassDot = { x: number; y: number; tone: GlassTone };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/** Days from 1 January to the last day of month `through` (1 to 12). */
export function daysThroughMonth(year: number, through: number): number {
  return Math.round((Date.UTC(year, through, 1) - Date.UTC(year, 0, 1)) / 86_400_000);
}

/**
 * The widest dot spacing that still seats every day of the year, so the dots
 * are as large as the glass allows and the glass is full on 31 December.
 */
function spacingFor(days: number, width: number, height: number): number {
  let low = 2;
  let high = 60;
  for (let step = 0; step < 30; step += 1) {
    const mid = (low + high) / 2;
    if (glassCapacity(width, height, mid) >= days) low = mid;
    else high = mid;
  }
  return low;
}

export type DotGlass = { width: number; height: number; spacing: number; dots: GlassDot[] };

/** Every dot of the glass, bottom row first, each with its tone. */
export function yearDotGlass({
  year,
  through,
  nights,
  width = 230,
  height = 400,
}: {
  year: number;
  through: number;
  nights: number;
  width?: number;
  height?: number;
}): DotGlass {
  const days = daysInYear(year);
  const read = daysThroughMonth(year, through);
  // A link may claim more nights than the days it was read to; the glass
  // cannot hold them, so it fills to the days read and no further.
  const lit = Math.max(0, Math.min(nights, read));
  const spacing = spacingFor(days, width, height);
  const dots: GlassDot[] = glassPoints(width, height, spacing, days).map((point, index) => ({
    ...point,
    tone: index < lit ? "night" : index < read ? "day" : "ahead",
  }));
  return { width, height, spacing, dots };
}
