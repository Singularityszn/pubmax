import { describe, it, expect } from "vitest";

import {
  LINE_COLOURS,
  lineColour,
  dayTypeForDate,
  matchesDayType,
  formatLastJourney,
} from "@/lib/tfl";

// These tests cover ONLY the pure helpers in lib/tfl.ts. No network — the fetch
// logic lives in the API route and is deliberately kept out of the unit surface.

describe("lineColour", () => {
  it("returns the official hex for known lines", () => {
    expect(lineColour("victoria")).toBe("#039BE5");
    expect(lineColour("central")).toBe("#DC241F");
    expect(lineColour("elizabeth")).toBe("#60399E");
    // Hyphenated ids resolve too.
    expect(lineColour("london-overground")).toBe("#FA7B05");
    expect(lineColour("hammersmith-city")).toBe("#F589A6");
  });

  it("falls back to the neutral colour for unknown lines", () => {
    expect(lineColour("does-not-exist")).toBe("#6b726a");
    expect(lineColour("")).toBe("#6b726a");
  });

  it("has a colour for every advertised line id", () => {
    // Sanity: the map is non-empty and every value is a hex string.
    const ids = Object.keys(LINE_COLOURS);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(LINE_COLOURS[id]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("dayTypeForDate", () => {
  // Fixed, unambiguous UTC dates with known weekdays. Using T12:00:00Z keeps the
  // local weekday stable across the timezones CI might run in.
  it("maps Monday through Thursday to mon-thu", () => {
    expect(dayTypeForDate(new Date("2026-07-06T12:00:00Z"))).toBe("mon-thu"); // Monday
    expect(dayTypeForDate(new Date("2026-07-07T12:00:00Z"))).toBe("mon-thu"); // Tuesday
    expect(dayTypeForDate(new Date("2026-07-08T12:00:00Z"))).toBe("mon-thu"); // Wednesday
    expect(dayTypeForDate(new Date("2026-07-09T12:00:00Z"))).toBe("mon-thu"); // Thursday
  });

  it("maps Friday to fri", () => {
    expect(dayTypeForDate(new Date("2026-07-10T12:00:00Z"))).toBe("fri"); // Friday
  });

  it("maps Saturday to sat", () => {
    expect(dayTypeForDate(new Date("2026-07-11T12:00:00Z"))).toBe("sat"); // Saturday
  });

  it("maps Sunday to sun", () => {
    expect(dayTypeForDate(new Date("2026-07-12T12:00:00Z"))).toBe("sun"); // Sunday
  });
});

describe("matchesDayType", () => {
  it("matches the real TfL schedule names case-insensitively", () => {
    expect(matchesDayType("Monday - Thursday", "mon-thu")).toBe(true);
    expect(matchesDayType("Friday", "fri")).toBe(true);
    expect(matchesDayType("Saturday", "sat")).toBe(true);
    expect(matchesDayType("Saturday (also Good Friday)", "sat")).toBe(true);
    expect(matchesDayType("Sunday", "sun")).toBe(true);
    expect(matchesDayType("MONDAY - THURSDAY", "mon-thu")).toBe(true);
  });

  it("does not match the wrong day type", () => {
    expect(matchesDayType("Friday", "mon-thu")).toBe(false);
    expect(matchesDayType("Monday - Thursday", "fri")).toBe(false);
    expect(matchesDayType("Sunday", "sat")).toBe(false);
    expect(matchesDayType("Saturday", "sun")).toBe(false);
  });
});

describe("formatLastJourney", () => {
  it("formats an evening (pre-midnight) time", () => {
    expect(formatLastJourney({ hour: 23, minute: 42 })).toEqual({
      clock: "23:42",
      pastMidnight: false,
    });
  });

  it("rolls hour 24 to 00 and flags past-midnight", () => {
    expect(formatLastJourney({ hour: 24, minute: 28 })).toEqual({
      clock: "00:28",
      pastMidnight: true,
    });
  });

  it("rolls a Night Tube hour (26) to 02 and flags past-midnight", () => {
    expect(formatLastJourney({ hour: 26, minute: 57 })).toEqual({
      clock: "02:57",
      pastMidnight: true,
    });
  });

  it("zero-pads single-digit hours and minutes", () => {
    expect(formatLastJourney({ hour: 5, minute: 3 })).toEqual({
      clock: "05:03",
      pastMidnight: false,
    });
  });
});
