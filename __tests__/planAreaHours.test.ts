import { describe, expect, it } from "vitest";

import { planTimeWindowFits, planTimeWindowsOff } from "@/lib/planAreaHours";
import { planAreaTimeFits } from "@/lib/planAreaHours.server";
import { PLAN_TIME_NONE_LINE, PLAN_TIME_SOME_LINE } from "@/lib/planCopy";
import type { PlanOpeningSchedule } from "@/lib/planRouteEvidence";

// A Monday afternoon in London.
const NOW = Date.parse("2026-11-23T12:00:00Z");
const DAY_MS = 86_400_000;
const AREA = { slug: "clapham", centre: { lat: 51.462, lng: -0.138 }, radiusKm: 2.4 } as const;
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function listedHours(ageDays = 2): PlanOpeningSchedule {
  return {
    venueListedOpen: true,
    ranges: WEEK.map((weekday) => ({ weekday, startsAt: "08:00", endsAt: "00:00" })),
    source: {
      label: "J D Wetherspoon: pub directory",
      url: "https://www.jdwetherspoon.com/pubs/",
      observedAt: new Date(NOW - ageDays * DAY_MS).toISOString(),
    },
  };
}

function fitsFor(pubs: { id: string; lat: number; lng: number; hours: PlanOpeningSchedule | null }[]) {
  return planAreaTimeFits(
    [AREA],
    pubs.map(({ id, lat, lng }) => ({ id, name: id, lat, lng })),
    new Map(pubs.map(({ id, hours }) => [id, hours])),
    NOW,
  );
}

describe("which times an area's listed opening hours can meet", () => {
  it("gives two pubs with hours a long walk apart one stop at a time, never two", () => {
    // Clapham's two Wetherspoon pubs sit 3.7 km apart.
    const fits = fitsFor([
      { id: "junction", lat: 51.4643, lng: -0.1705, hours: listedHours() },
      { id: "common", lat: 51.4613, lng: -0.1179, hours: listedHours() },
    ]);
    expect(fits.clapham?.evening).toBe(1);
    expect(planTimeWindowFits(fits, "clapham", "evening", 2)).toBe(false);
    expect(planTimeWindowFits(fits, "clapham", "evening", 3)).toBe(false);
  });

  it("gives three close pubs with hours a three-stop evening", () => {
    const fits = fitsFor([
      { id: "a", lat: 51.462, lng: -0.138, hours: listedHours() },
      { id: "b", lat: 51.4625, lng: -0.137, hours: listedHours() },
      { id: "c", lat: 51.463, lng: -0.1385, hours: listedHours() },
    ]);
    expect(planTimeWindowFits(fits, "clapham", "evening", 3)).toBe(true);
    expect(planTimeWindowFits(fits, "clapham", "after-work", 3)).toBe(true);
  });

  it("counts no pub whose hours are stale, unlisted or outside the area", () => {
    const fits = fitsFor([
      { id: "a", lat: 51.462, lng: -0.138, hours: listedHours() },
      { id: "stale", lat: 51.4625, lng: -0.137, hours: listedHours(31) },
      { id: "none", lat: 51.463, lng: -0.1385, hours: null },
      { id: "far", lat: 51.6, lng: -0.138, hours: listedHours() },
    ]);
    expect(fits.clapham?.evening).toBe(1);
    expect(fitsFor([{ id: "none", lat: 51.462, lng: -0.138, hours: null }])).toEqual({});
  });

  it("names every time off, some times off, or none", () => {
    const fits = { clapham: { evening: 3, "after-work": 3, late: 2 } };
    expect(planTimeWindowsOff(fits, "clapham", 3)).toEqual({ off: new Set(["late"]), line: PLAN_TIME_SOME_LINE });
    expect(planTimeWindowsOff(fits, "clapham", 2)).toEqual({ off: new Set(), line: null });
    expect(planTimeWindowsOff(fits, "victoria", 3)).toEqual({
      off: new Set(["after-work", "evening", "late"]),
      line: PLAN_TIME_NONE_LINE,
    });
  });

  it("says nothing against a time while the area or the fits are not known", () => {
    expect(planTimeWindowFits({}, null, "evening", 3)).toBe(true);
    expect(planTimeWindowFits(null, "clapham", "evening", 3)).toBe(true);
  });
});
