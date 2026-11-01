import { describe, expect, it } from "vitest";

import {
  ENGLAND_WALES_BANK_HOLIDAYS,
  isBankHoliday,
  londonCivilTime,
  londonWallClockInstant,
  minutesUntilClose,
  readHolidayAwareHours,
} from "@/lib/lastOrders";

// Friday 30 October 2026 is after the clocks went back, so London is on GMT
// and a `Z` instant is the London wall clock.
const FRIDAY_2245 = new Date("2026-10-30T22:45:00Z");
const SATURDAY_0100 = new Date("2026-10-31T01:00:00Z");

describe("minutesUntilClose", () => {
  it("counts down to a close later the same evening", () => {
    expect(minutesUntilClose("Mo-Su 12:00-23:30", FRIDAY_2245)).toEqual({
      state: "open",
      minutesLeft: 45,
      closesAt: "23:30",
    });
  });

  it("reads a close after midnight written as 01:00", () => {
    expect(minutesUntilClose("Su-Th 12:00-23:00; Fr-Sa 12:00-01:00", FRIDAY_2245)).toEqual({
      state: "open",
      minutesLeft: 135,
      closesAt: "01:00",
    });
  });

  it("keeps yesterday's window open past midnight, written as 26:30", () => {
    expect(minutesUntilClose("Mo-Th 11:00-24:00; Fr 11:00-26:30; Sa-Su 11:00-23:00", SATURDAY_0100)).toEqual({
      state: "open",
      minutesLeft: 90,
      closesAt: "02:30",
    });
  });

  it("joins windows that touch at midnight into one stretch", () => {
    expect(minutesUntilClose("Fr 12:00-24:00; Sa 00:00-02:00", FRIDAY_2245)).toEqual({
      state: "open",
      minutesLeft: 195,
      closesAt: "02:00",
    });
  });

  it("is closed after the stated close, and on a day the string leaves out", () => {
    expect(minutesUntilClose("Mo-Su 12:00-22:00", FRIDAY_2245)).toEqual({ state: "closed" });
    expect(minutesUntilClose("Mo-Th 12:00-23:00", FRIDAY_2245)).toEqual({ state: "closed" });
    expect(minutesUntilClose("Mo-Th 12:00-23:00; Fr off", FRIDAY_2245)).toEqual({ state: "closed" });
  });

  it("answers 24/7 as open all night, with no invented close", () => {
    expect(minutesUntilClose("24/7", FRIDAY_2245)).toEqual({ state: "open-all-night" });
    expect(minutesUntilClose("Mo-Su 00:00-24:00", FRIDAY_2245)).toEqual({ state: "open-all-night" });
  });

  it("is unknown with no hours, and with a rule it does not read", () => {
    expect(minutesUntilClose(null, FRIDAY_2245)).toEqual({ state: "unknown", reason: "no-hours" });
    expect(minutesUntilClose("  ", FRIDAY_2245)).toEqual({ state: "unknown", reason: "no-hours" });
    expect(minutesUntilClose("Mo-Su 12:00-23:00; Dec 25 off", FRIDAY_2245)).toEqual({
      state: "unknown",
      reason: "unreadable",
    });
    expect(minutesUntilClose("Mo-Fr 12:00+", FRIDAY_2245)).toEqual({ state: "unknown", reason: "unreadable" });
    expect(minutesUntilClose('Mo-Su 12:00-23:00 "ring first"', FRIDAY_2245)).toEqual({
      state: "unknown",
      reason: "unreadable",
    });
    expect(minutesUntilClose("Mo-Fr 12:00-23:00; SH off", FRIDAY_2245)).toEqual({
      state: "unknown",
      reason: "unreadable",
    });
  });

  describe("bank holidays", () => {
    // Monday 31 August 2026, the summer bank holiday. London is on BST, so
    // 21:45 UTC is 22:45 on the wall clock.
    const BANK_HOLIDAY_2245 = new Date("2026-08-31T21:45:00Z");

    it("uses the PH rule on a bank holiday", () => {
      expect(minutesUntilClose("Mo-Sa 12:00-23:30; Su,PH 12:00-23:00", BANK_HOLIDAY_2245)).toEqual({
        state: "open",
        minutesLeft: 15,
        closesAt: "23:00",
      });
    });

    it("uses the weekday rule on an ordinary day, even when a PH rule is stated", () => {
      expect(minutesUntilClose("Mo-Sa 12:00-23:30; Su,PH 12:00-23:00", FRIDAY_2245)).toEqual({
        state: "open",
        minutesLeft: 45,
        closesAt: "23:30",
      });
    });

    it("reads PH off as closed on the holiday", () => {
      expect(minutesUntilClose("Mo-Su 12:00-23:30; PH off", BANK_HOLIDAY_2245)).toEqual({ state: "closed" });
    });

    it("is unknown on a bank holiday the string says nothing about", () => {
      expect(minutesUntilClose("Mo-Su 12:00-23:30", BANK_HOLIDAY_2245)).toEqual({
        state: "unknown",
        reason: "holiday-hours-unstated",
      });
    });

    it("still reads yesterday's late window into a bank holiday morning", () => {
      // 00:30 BST on the bank holiday Monday is 23:30 UTC on Sunday.
      const earlyHoliday = new Date("2026-08-30T23:30:00Z");
      expect(minutesUntilClose("Mo-Sa 12:00-23:00; Su 12:00-01:00", earlyHoliday)).toEqual({
        state: "open",
        minutesLeft: 30,
        closesAt: "01:00",
      });
    });

    it("is unknown in a year the calendar does not hold", () => {
      expect(minutesUntilClose("Mo-Su 12:00-23:30", new Date("2031-10-31T22:45:00Z"))).toEqual({
        state: "unknown",
        reason: "holiday-calendar-unknown",
      });
    });
  });
});

describe("the nights the clocks change", () => {
  it("counts real minutes when the clocks go forward (28 March 2027)", () => {
    // 00:55 GMT. At 01:00 GMT the clocks jump to 02:00 BST, so a 02:05 close
    // is 01:05 UTC: ten real minutes, not seventy wall-clock ones.
    expect(minutesUntilClose("Sa 18:00-02:05", new Date("2027-03-28T00:55:00Z"))).toEqual({
      state: "open",
      minutesLeft: 10,
      closesAt: "02:05",
    });
  });

  it("never runs long when the clocks go back (25 October 2026)", () => {
    // 01:15 BST, the first 01:15 of the night. 01:30 happens twice; the
    // countdown takes the first, 15 minutes away, never the second at 75.
    expect(minutesUntilClose("Sa 12:00-01:30", new Date("2026-10-25T00:15:00Z"))).toEqual({
      state: "open",
      minutesLeft: 15,
      closesAt: "01:30",
    });
    // After the change a 02:30 close is plain GMT again.
    expect(minutesUntilClose("Sa 12:00-02:30", new Date("2026-10-25T01:15:00Z"))).toEqual({
      state: "open",
      minutesLeft: 75,
      closesAt: "02:30",
    });
  });

  it("places a wall-clock time on the earliest instant it can name", () => {
    const at = (ymd: string, hhmm: string) => {
      const [h = 0, m = 0] = hhmm.split(":").map(Number);
      return new Date(londonWallClockInstant(ymd, h * 60 + m)).toISOString();
    };
    expect(at("2026-10-30", "22:45")).toBe("2026-10-30T22:45:00.000Z");
    expect(at("2026-08-31", "22:45")).toBe("2026-08-31T21:45:00.000Z");
    // Gone when the clocks go forward: the earliest candidate, before the jump.
    expect(at("2027-03-28", "01:30")).toBe("2027-03-28T00:30:00.000Z");
    // Twice when the clocks go back: the first one, in BST.
    expect(at("2026-10-25", "01:30")).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("readHolidayAwareHours", () => {
  it("keeps the holiday rule apart from the Sunday it shares a line with", () => {
    const hours = readHolidayAwareHours("Mo-Sa 11:00-23:00; Su,PH 12:00-19:00");
    expect(hours?.holiday).toEqual([{ opens: "12:00", closes: "19:00" }]);
    expect(hours?.weekly[0]).toEqual([{ opens: "12:00", closes: "19:00" }]);
    expect(hours?.weekly[3]).toEqual([{ opens: "11:00", closes: "23:00" }]);
  });

  it("leaves the holiday unstated when the string has no PH rule", () => {
    expect(readHolidayAwareHours("Mo-Su 11:00-23:00")?.holiday).toBeNull();
  });
});

describe("the calendar", () => {
  it("knows the bank holidays it holds and admits the years it does not", () => {
    expect(isBankHoliday("2026-12-28")).toBe(true);
    expect(isBankHoliday("2026-12-26")).toBe(false);
    expect(isBankHoliday("2030-01-01")).toBeNull();
    for (const [year, days] of Object.entries(ENGLAND_WALES_BANK_HOLIDAYS)) {
      expect(days).toHaveLength(8);
      for (const day of days) expect(day.startsWith(`${year}-`)).toBe(true);
    }
  });

  it("holds this year and next, so Last orders never goes blank on 1 January", () => {
    // Deliberately reads the REAL clock. Out of the calendar every pub's hours
    // are unknown and the list empties, so this fails a full year early: on
    // 1 January 2027 it asks for 2028. Add the next year from
    // https://www.gov.uk/bank-holidays to ENGLAND_WALES_BANK_HOLIDAYS.
    const year = new Date().getUTCFullYear();
    for (const needed of [year, year + 1]) {
      expect(ENGLAND_WALES_BANK_HOLIDAYS[needed], `bank holidays for ${needed}`).toBeDefined();
    }
  });

  it("reads the London wall clock across the clock change", () => {
    expect(londonCivilTime(new Date("2026-08-31T21:45:00Z"))).toMatchObject({
      day: { ymd: "2026-08-31", weekday: 1 },
      minutes: 22 * 60 + 45,
    });
    expect(londonCivilTime(FRIDAY_2245)).toMatchObject({ day: { ymd: "2026-10-30", weekday: 5 }, minutes: 1365 });
  });
});
