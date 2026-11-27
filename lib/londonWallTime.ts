/**
 * A Europe/London wall-clock time as an absolute instant, and back.
 *
 * One owner for this conversion. lib/icsExport.ts keeps its own copy because
 * that generator is dependency-free by design.
 */

export type LondonWallParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

// Building an Intl.DateTimeFormat is the expensive part of reading a London
// wall clock, and lib/whatsOn.ts takes a reading per row. One lazily built
// instance serves the whole process.
let londonPartsFormatter: Intl.DateTimeFormat | null = null;

function londonPartsFormat(): Intl.DateTimeFormat {
  londonPartsFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return londonPartsFormatter;
}

/** The London wall clock at an instant. */
export function londonWallParts(base: Date): LondonWallParts {
  const parts = londonPartsFormat().formatToParts(base);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * A Date whose local-time getters read the London wall clock at `base`, so
 * getDay() and getHours() answer for the drinker, not the server. Only its
 * getters are meaningful; its getTime() is not the instant `base`.
 */
export function londonWallClockDate(base: Date): Date {
  const p = londonWallParts(base);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// London's UTC offset (ms) at a given instant, derived by comparing the London
// wall-clock reading of `base` to `base` itself. +3600000 in summer (BST),
// 0 in winter (GMT).
function londonOffsetMs(base: Date): number {
  const p = londonWallParts(base);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(base.getTime() / 1000) * 1000;
}

// Convert a London wall-clock time to an absolute instant. Two offset passes are
// enough because Europe/London has only the GMT and BST offsets and no caller
// asks for an hour inside the repeated or skipped transition hour. Resolve each
// edge of a window on its own: one offset for both edges makes a window an hour
// wrong on a clock-change night.
export function londonWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0);
  let instant = wallAsUtc - londonOffsetMs(new Date(wallAsUtc));
  instant = wallAsUtc - londonOffsetMs(new Date(instant));
  return instant;
}
