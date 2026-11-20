import { describe, expect, it } from "vitest";

import { dealIsOn, parseDealSchedule } from "@/lib/dealSchedule";

describe("deal schedules", () => {
  it("uses London time and excludes the end boundary", () => {
    const schedule = parseDealSchedule({ days: [1], start: "16:00", end: "19:00" });
    expect(schedule).not.toBeNull();
    expect(dealIsOn(schedule!, new Date("2026-06-01T15:00:00Z"))).toBe(true);
    expect(dealIsOn(schedule!, new Date("2026-06-01T18:00:00Z"))).toBe(false);
  });

  it("carries an overnight window into the following day", () => {
    const schedule = parseDealSchedule({ days: [5], start: "22:00", end: "01:00" });
    expect(schedule).not.toBeNull();
    expect(dealIsOn(schedule!, new Date("2026-11-21T00:30:00Z"))).toBe(true);
    expect(dealIsOn(schedule!, new Date("2026-11-21T01:00:00Z"))).toBe(false);
    expect(dealIsOn(schedule!, new Date("2026-11-22T00:30:00Z"))).toBe(false);
  });

  it("rejects incomplete or ambiguous schedules", () => {
    expect(parseDealSchedule({ days: [], start: "16:00", end: "19:00" })).toBeNull();
    expect(parseDealSchedule({ days: [1], start: "16:00", end: "16:00" })).toBeNull();
    expect(parseDealSchedule({ days: [7], start: "16:00", end: "19:00" })).toBeNull();
    expect(parseDealSchedule({ days: [1], start: "25:00", end: "19:00" })).toBeNull();
  });
});
