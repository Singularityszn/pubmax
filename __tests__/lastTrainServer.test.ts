import { describe, expect, it, vi } from "vitest";

import {
  latestJourneyForDay,
  mergeTimetableSchedules,
  nextFromSchedulesAfter,
  serviceFrameNowMinutes,
  stableCacheControl,
  summarizeLineStatuses,
} from "@/lib/lastTrain.server";

describe("last-train server seams", () => {
  it("selects latest matching journey and keeps after-midnight service latest", () => {
    const latest = latestJourneyForDay(
      [
        { name: "Monday - Friday", lastJourney: { hour: "23", minute: "58" } },
        { name: "Monday - Friday", lastJourney: { hour: "24", minute: "17" } },
        { name: "Saturday", lastJourney: { hour: "25", minute: "10" } },
      ],
      "mon-thu",
    );

    expect(latest).toEqual({ hour: "24", minute: "17" });
  });

  it("merges all schedules from timetable disambiguation options", async () => {
    const resolve = vi.fn(async (uri: string) => ({
      timetable: {
        routes: [{ schedules: [{ name: uri, lastJourney: { hour: 23, minute: 30 } }] }],
      },
    }));

    const schedules = await mergeTimetableSchedules(
      {
        disambiguation: {
          disambiguationOptions: [{ uri: "/north" }, {}, { uri: "/south" }],
        },
      },
      resolve,
    );

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(schedules.map((schedule) => schedule.name)).toEqual(["/north", "/south"]);
  });

  it("starts timetable disambiguation reads in parallel", async () => {
    let releaseNorth!: () => void;
    let northReleased = false;
    const northGate = new Promise<void>((resolve) => {
      releaseNorth = resolve;
    });
    const starts: string[] = [];
    const resolve = vi.fn(async (uri: string) => {
      starts.push(`${uri}:${northReleased ? "after" : "before"}`);
      if (uri === "/north") await northGate;
      return {
        timetable: {
          routes: [{ schedules: [{ name: uri, lastJourney: { hour: 23, minute: 30 } }] }],
        },
      };
    });

    const pending = mergeTimetableSchedules(
      {
        disambiguation: {
          disambiguationOptions: [{ uri: "/north" }, { uri: "/south" }],
        },
      },
      resolve,
    );
    await Promise.resolve();
    northReleased = true;
    releaseNorth();

    await expect(pending).resolves.toHaveLength(2);
    expect(starts).toEqual(["/north:before", "/south:before"]);
  });

  it("orders upcoming timetable departures and lists none once all have gone", () => {
    const schedules = [
      { name: "Monday - Friday", lastJourney: { hour: 23, minute: 45 } },
      { name: "Monday - Friday", lastJourney: { hour: 24, minute: 15 } },
      { name: "Monday - Friday", lastJourney: { hour: 22, minute: 30 } },
    ];

    expect(nextFromSchedulesAfter(schedules, "mon-thu", 23 * 60)).toEqual([
      { clock: "23:45" },
      { clock: "00:15" },
    ]);
    // 02:00 in the service frame: every train has left. A departed train is
    // never presented as a next departure.
    expect(nextFromSchedulesAfter(schedules, "mon-thu", 26 * 60)).toEqual([]);
  });

  it("keeps the genuinely upcoming 00:28 at 00:20 in the route's service frame", () => {
    const schedules = [
      { name: "Monday - Friday", lastJourney: { hour: 22, minute: 30 } },
      { name: "Monday - Friday", lastJourney: { hour: 23, minute: 45 } },
      { name: "Monday - Friday", lastJourney: { hour: 24, minute: 15 } },
      { name: "Monday - Friday", lastJourney: { hour: 24, minute: 28 } },
    ];
    // The route's own conversion of a London 00:20 wall clock.
    const nowMinutes = serviceFrameNowMinutes(new Date(2026, 6, 11, 0, 20));
    expect(nowMinutes).toBe(1460);
    expect(nextFromSchedulesAfter(schedules, "mon-thu", nowMinutes)).toEqual([
      { clock: "00:28" },
    ]);
  });

  it("puts the small hours after the evening in the service frame", () => {
    expect(serviceFrameNowMinutes(new Date(2026, 6, 10, 23, 30))).toBe(1410);
    expect(serviceFrameNowMinutes(new Date(2026, 6, 11, 3, 59))).toBe(1679);
    expect(serviceFrameNowMinutes(new Date(2026, 6, 11, 4, 0))).toBe(240);
  });

  it("keeps the stable scope's shared cache short and inside the service day", () => {
    expect(stableCacheControl(new Date(2026, 6, 11, 22, 0, 0))).toBe(
      "public, s-maxage=60, stale-while-revalidate=60",
    );
    // 03:58:30: 90 s to the 04:00 rollover, so fresh plus stale ends at it.
    expect(stableCacheControl(new Date(2026, 6, 11, 3, 58, 30))).toBe(
      "public, s-maxage=60, stale-while-revalidate=30",
    );
    expect(stableCacheControl(new Date(2026, 6, 11, 3, 59, 30))).toBe(
      "public, s-maxage=30",
    );
  });

  it("aggregates disrupted lines and ignores good service", () => {
    const result = summarizeLineStatuses([
      {
        id: "victoria",
        name: "Victoria",
        lineStatuses: [{ statusSeverityDescription: "Good Service" }],
      },
      {
        id: "central",
        name: "Central",
        lineStatuses: [{ statusSeverityDescription: "Severe Delays" }],
      },
      {
        id: "district",
        name: "District",
        lineStatuses: [{ statusSeverityDescription: "Part Closure" }],
      },
    ]);

    expect(result.summary).toBe("Central: Severe Delays · District: Part Closure");
    expect([...result.affectedLineIds]).toEqual(["central", "district"]);
  });
});
