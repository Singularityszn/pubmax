import { describe, it, expect } from "vitest";

import {
  LINE_COLOURS,
  lineColour,
  dayTypeForDate,
  matchesDayType,
  formatLastJourney,
  computeLastPintDecision,
  walkMinutesForKm,
  BUFFER_MINUTES,
  type LastPintDecisionInput,
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

describe("walkMinutesForKm", () => {
  it("converts a straight-line distance to minutes at the walking pace", () => {
    // 4.8 km/h -> 1km takes 12.5min, rounded to 13.
    expect(walkMinutesForKm(1)).toBe(13);
    // 0.4km at 4.8km/h = 5min exactly.
    expect(walkMinutesForKm(0.4)).toBe(5);
  });

  it("treats zero/negative/non-finite distance as zero minutes", () => {
    expect(walkMinutesForKm(0)).toBe(0);
    expect(walkMinutesForKm(-1)).toBe(0);
    expect(walkMinutesForKm(Number.NaN)).toBe(0);
  });
});

describe("computeLastPintDecision", () => {
  const now = new Date("2026-07-10T22:00:00Z"); // fixed instant for leaveByIso maths

  const baseInput: LastPintDecisionInput = {
    minutesUntilLastTrain: 0,
    walkMinutesEstimate: 5,
    stationName: "Angel",
    lineNames: ["Northern"],
    disruptionOnNeededLine: false,
    now,
  };

  it("documents the buffer constant used when the caller doesn't override it", () => {
    expect(BUFFER_MINUTES).toBe(5);
  });

  it("returns live_data_unavailable when TfL couldn't be reached (live: false)", () => {
    const result = computeLastPintDecision({ ...baseInput, live: false });
    expect(result.decision).toBe("live_data_unavailable");
    expect(result.leaveByIso).toBeNull();
    expect(result.live).toBe(false);
  });

  it("returns live_data_unavailable when there's no last-train time at all", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: null });
    expect(result.decision).toBe("live_data_unavailable");
    expect(result.leaveByIso).toBeNull();
  });

  it("returns order_one_more when margin is well over 45 minutes", () => {
    // 60 - 5 (walk) - 5 (buffer) = 50 margin.
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 60 });
    expect(result.decision).toBe("order_one_more");
  });

  it("returns order_one_more at the >45 boundary (margin = 46)", () => {
    // minutesUntilLastTrain - walk(5) - buffer(5) = 46 -> minutesUntilLastTrain = 56
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 56 });
    expect(result.decision).toBe("order_one_more");
  });

  it("returns order_one_more at the margin = 45 boundary (>= 45 rounds up to order_one_more)", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 55 });
    expect(result.decision).toBe("order_one_more");
  });

  it("returns half_pint_only just under the margin = 45 boundary (margin = 44)", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 54 });
    expect(result.decision).toBe("half_pint_only");
  });

  it("returns half_pint_only in the middle of the 20-45 band", () => {
    // margin = 30 -> minutesUntilLastTrain = 40
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 40 });
    expect(result.decision).toBe("half_pint_only");
  });

  it("returns half_pint_only at the margin = 20 boundary (still half_pint)", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 30 });
    expect(result.decision).toBe("half_pint_only");
  });

  it("returns settle_up_now just under the margin = 20 boundary", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 29 });
    expect(result.decision).toBe("settle_up_now");
  });

  it("returns settle_up_now in the middle of the 5-20 band", () => {
    // margin = 10 -> minutesUntilLastTrain = 20
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 20 });
    expect(result.decision).toBe("settle_up_now");
  });

  it("returns settle_up_now at the margin = 5 boundary (still settle_up, not train_risk)", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 15 });
    expect(result.decision).toBe("settle_up_now");
  });

  it("returns train_risk just under the margin = 5 boundary", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 14 });
    expect(result.decision).toBe("train_risk");
  });

  it("returns train_risk when the margin is negative (train already effectively gone)", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: -10 });
    expect(result.decision).toBe("train_risk");
  });

  it("returns train_risk on disruption even with a huge margin", () => {
    const result = computeLastPintDecision({
      ...baseInput,
      minutesUntilLastTrain: 120,
      disruptionOnNeededLine: true,
      disruptionSummary: "Northern: Severe Delays",
    });
    expect(result.decision).toBe("train_risk");
    expect(result.disruptionSummary).toBe("Northern: Severe Delays");
  });

  it("computes leaveByIso as now + (minutesUntilLastTrain - walk)", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 40 });
    // now (22:00:00Z) + (40 - 5) minutes = 22:35:00Z
    expect(result.leaveByIso).toBe("2026-07-10T22:35:00.000Z");
  });

  it("handles an after-midnight last train (large minutesUntilLastTrain) for leaveByIso", () => {
    // e.g. it's 23:50 and the last train (tomorrow's small hours) is 130 minutes away.
    const result = computeLastPintDecision({
      ...baseInput,
      minutesUntilLastTrain: 130,
      walkMinutesEstimate: 10,
      now: new Date("2026-07-10T23:50:00Z"),
    });
    // 23:50Z + (130 - 10) = +120min = 01:50Z the next day.
    expect(result.leaveByIso).toBe("2026-07-11T01:50:00.000Z");
    expect(result.decision).toBe("order_one_more");
  });

  it("respects a custom bufferMinutes override", () => {
    // margin with buffer=0: 15 - 5 - 0 = 10 -> settle_up_now under default buffer(5)
    // but with buffer=20: 15 - 5 - 20 = -10 -> train_risk.
    const result = computeLastPintDecision({
      ...baseInput,
      minutesUntilLastTrain: 15,
      bufferMinutes: 20,
    });
    expect(result.decision).toBe("train_risk");
    expect(result.bufferMinutes).toBe(20);
  });

  it("passes through station/line/destination context untouched", () => {
    const result = computeLastPintDecision({
      ...baseInput,
      minutesUntilLastTrain: 60,
      stationName: "Highbury & Islington",
      lineNames: ["Victoria", "Overground"],
      destinationLabel: "Home",
    });
    expect(result.stationName).toBe("Highbury & Islington");
    expect(result.lineNames).toEqual(["Victoria", "Overground"]);
    expect(result.destinationLabel).toBe("Home");
    expect(result.walkMinutesEstimate).toBe(5);
  });

  it("defaults destinationLabel to null and live to true when not provided", () => {
    const result = computeLastPintDecision({ ...baseInput, minutesUntilLastTrain: 60 });
    expect(result.destinationLabel).toBeNull();
    expect(result.live).toBe(true);
  });
});
