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

describe("reported deal availability", () => {
  it("excludes expired deals from the sheet", async () => {
    const { dealIsVisible } = await import("@/lib/dealSchedule");
    expect(dealIsVisible({ endDate: "2026-11-19" }, new Date("2026-11-20T12:00:00Z"))).toBe(false);
    expect(dealIsVisible({ endDate: "2026-11-20" }, new Date("2026-11-20T12:00:00Z"))).toBe(true);
    expect(dealIsVisible({ endDate: null }, new Date("2026-11-20T12:00:00Z"))).toBe(true);
  });

  it("requires a recent report for an open-ended deal to count on now", async () => {
    const { dealAvailableNow } = await import("@/lib/dealSchedule");
    const schedule = { days: [5], start: "16:00", end: "19:00" };
    const now = new Date("2026-11-20T17:00:00Z");
    expect(dealAvailableNow({ schedule, endDate: null, reportedAt: "2026-10-21T17:00:00Z" }, now)).toBe(true);
    expect(dealAvailableNow({ schedule, endDate: null, reportedAt: "2026-10-21T16:59:59Z" }, now)).toBe(false);
    expect(dealAvailableNow({ schedule, endDate: "2026-11-20", reportedAt: "2026-01-01T12:00:00Z" }, now)).toBe(true);
    expect(dealAvailableNow({ schedule, endDate: "2026-11-19", reportedAt: "2026-11-20T12:00:00Z" }, now)).toBe(false);
  });
});

it("finds London midnight across clock changes", async () => {
  const { nextLondonMidnight } = await import("@/lib/dealSchedule");
  expect(new Date(nextLondonMidnight(Date.parse("2026-03-29T12:00:00Z"))).toISOString()).toBe("2026-03-29T23:00:00.000Z");
  expect(new Date(nextLondonMidnight(Date.parse("2026-10-25T12:00:00Z"))).toISOString()).toBe("2026-10-26T00:00:00.000Z");
});
