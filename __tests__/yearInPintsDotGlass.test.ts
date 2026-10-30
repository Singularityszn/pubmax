import { describe, expect, it } from "vitest";

import { daysInYear, daysThroughMonth, yearDotGlass } from "@/lib/yearInPintsDotGlass";

// The Year in Pints glass (lib/yearInPintsDotGlass.tsx): one dot per day of the
// year, lit from the bottom one per night out, dim for the rest of the days
// read so far, faint for the days still to come.

function tones(glass: ReturnType<typeof yearDotGlass>) {
  const count = { night: 0, day: 0, ahead: 0 };
  for (const dot of glass.dots) count[dot.tone] += 1;
  return count;
}

describe("the days a glass holds", () => {
  it("knows a leap year", () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2028)).toBe(366);
  });

  it("counts the days to the end of the month read to", () => {
    expect(daysThroughMonth(2026, 1)).toBe(31);
    expect(daysThroughMonth(2026, 10)).toBe(304);
    expect(daysThroughMonth(2026, 12)).toBe(365);
    expect(daysThroughMonth(2028, 2)).toBe(60);
  });
});

describe("yearDotGlass", () => {
  it("holds exactly one dot per day of the year", () => {
    expect(yearDotGlass({ year: 2026, through: 10, nights: 40 }).dots).toHaveLength(365);
    expect(yearDotGlass({ year: 2028, through: 12, nights: 40 }).dots).toHaveLength(366);
  });

  it("lights one dot per night, dims the rest of the days read, and fades the days ahead", () => {
    expect(tones(yearDotGlass({ year: 2026, through: 10, nights: 40 }))).toEqual({
      night: 40,
      day: 304 - 40,
      ahead: 365 - 304,
    });
    expect(tones(yearDotGlass({ year: 2026, through: 12, nights: 1 }))).toEqual({ night: 1, day: 364, ahead: 0 });
  });

  it("fills from the bottom: no lit dot sits above a dim one", () => {
    const { dots } = yearDotGlass({ year: 2026, through: 6, nights: 50 });
    const highestNight = Math.min(...dots.filter((dot) => dot.tone === "night").map((dot) => dot.y));
    const lowestDay = Math.max(...dots.filter((dot) => dot.tone === "day").map((dot) => dot.y));
    expect(highestNight).toBeGreaterThanOrEqual(lowestDay);
  });

  it("cannot hold more nights than the days the year was read to", () => {
    expect(tones(yearDotGlass({ year: 2026, through: 1, nights: 300 }))).toEqual({ night: 31, day: 0, ahead: 334 });
  });

  it("keeps every dot inside the drawing", () => {
    const glass = yearDotGlass({ year: 2028, through: 12, nights: 366, width: 200, height: 340 });
    for (const dot of glass.dots) {
      expect(dot.x).toBeGreaterThan(0);
      expect(dot.x).toBeLessThan(glass.width);
      expect(dot.y).toBeGreaterThan(0);
      expect(dot.y).toBeLessThan(glass.height);
    }
  });
});
