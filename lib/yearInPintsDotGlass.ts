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
// in app/year-in-pints/[year]/YearGlass.tsx.

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

/** The glass outline: a pint that widens toward the rim, with a nonic bulge below it. */
function glassWidthAt(t: number, base: number, rim: number): number {
  const taper = base + (rim - base) * t;
  const bulge = t > 0.72 && t < 0.92 ? Math.sin(((t - 0.72) / 0.2) * Math.PI) * rim * 0.05 : 0;
  return taper + bulge;
}

function rowCapacities(height: number, base: number, rim: number, spacing: number): number[] {
  const rowStep = spacing * (Math.sqrt(3) / 2);
  const rows: number[] = [];
  // A row is seated only when its whole dot fits under the rim.
  for (let y = spacing / 2; y + spacing / 2 <= height; y += rowStep) {
    let n = Math.max(1, Math.floor(glassWidthAt(y / height, base, rim) / spacing));
    // Neighbouring rows differ in parity, so each centred row sits half a dot
    // across from the one below and the lattice packs as a honeycomb.
    const below = rows[rows.length - 1];
    if (below !== undefined && n % 2 === below % 2) n = n > 1 ? n - 1 : n + 1;
    rows.push(n);
  }
  return rows;
}

/**
 * The widest dot spacing that still seats every day of the year, so the dots
 * are as large as the glass allows and the glass is full on 31 December.
 */
function spacingFor(days: number, height: number, base: number, rim: number): number {
  let low = 2;
  let high = 60;
  for (let step = 0; step < 30; step += 1) {
    const mid = (low + high) / 2;
    const capacity = rowCapacities(height, base, rim, mid).reduce((sum, n) => sum + n, 0);
    if (capacity >= days) low = mid;
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
  const base = width * 0.74;
  const rim = width * 0.94;
  const spacing = spacingFor(days, height, base, rim);
  const rowStep = spacing * (Math.sqrt(3) / 2);
  const capacities = rowCapacities(height, base, rim, spacing);

  const dots: GlassDot[] = [];
  let row = 0;
  while (dots.length < days && row < capacities.length) {
    const n = Math.min(capacities[row] ?? 0, days - dots.length);
    const y = height - spacing / 2 - row * rowStep;
    for (let k = 0; k < n; k += 1) {
      const index = dots.length;
      const tone: GlassTone = index < lit ? "night" : index < read ? "day" : "ahead";
      const x = width / 2 + (k - (n - 1) / 2) * spacing;
      dots.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, tone });
    }
    row += 1;
  }
  return { width, height, spacing, dots };
}
