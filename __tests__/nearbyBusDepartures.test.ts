import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUS_DEPARTURES_REFRESH_MS,
  BUS_DEPARTURES_TICK_MS,
  BUS_UPSTREAM_BUDGET_MS,
  busDeparturesFreshness,
  departureDueMinutes,
  freshBusPredictions,
  shouldPollBusDepartures,
  startBusDeparturesPoll,
} from "@/lib/nearbyBusDepartures";

describe("freshBusPredictions", () => {
  const now = new Date("2026-07-28T22:40:00.000Z");

  it("keeps fresh directed predictions and sorts them by expected arrival", () => {
    const result = freshBusPredictions(
      [
        {
          naptanId: "490000123B",
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          timestamp: "2026-07-28T22:39:20.000Z",
          expectedArrival: "2026-07-28T22:46:00.000Z",
        },
        {
          naptanId: "490000123B",
          lineName: "45",
          destinationName: "Clapham Park",
          direction: "inbound",
          timestamp: "2026-07-28T22:39:40.000Z",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ],
      now,
    );

    expect(result).toEqual([
      {
        naptanId: "490000123B",
        lineName: "45",
        destinationName: "Clapham Park",
        direction: "inbound",
        expectedArrival: "2026-07-28T22:43:00.000Z",
        dueMinutes: 3,
      },
      {
        naptanId: "490000123B",
        lineName: "63",
        destinationName: "King's Cross",
        direction: "outbound",
        expectedArrival: "2026-07-28T22:46:00.000Z",
        dueMinutes: 6,
      },
    ]);
  });

  it("removes stale, unaged, past, distant, and undirected predictions", () => {
    const base = {
      naptanId: "490000123B",
      lineName: "63",
      destinationName: "King's Cross",
      direction: "outbound",
      timestamp: "2026-07-28T22:39:00.000Z",
      expectedArrival: "2026-07-28T22:44:00.000Z",
    };

    const result = freshBusPredictions(
      [
        base,
        { ...base, lineName: "stale", timestamp: "2026-07-28T22:37:59.000Z" },
        { ...base, lineName: "missing-age", timestamp: undefined },
        { ...base, lineName: "gone", expectedArrival: "2026-07-28T22:39:59.000Z" },
        { ...base, lineName: "too-far", expectedArrival: "2026-07-28T23:40:01.000Z" },
        { ...base, lineName: "no-destination", destinationName: " " },
      ],
      now,
    );

    expect(result.map((prediction) => prediction.lineName)).toEqual(["63"]);
  });

  it("tolerates a small upstream clock lead without loosening the stale ceiling", () => {
    const base = {
      naptanId: "490000123B",
      lineName: "63",
      destinationName: "King's Cross",
      direction: "outbound",
      expectedArrival: "2026-07-28T22:44:00.000Z",
    };

    const result = freshBusPredictions(
      [
        { ...base, lineName: "skewed", timestamp: "2026-07-28T22:40:03.000Z" },
        { ...base, lineName: "far-future", timestamp: "2026-07-28T22:40:30.000Z" },
        { ...base, lineName: "stale", timestamp: "2026-07-28T22:37:30.000Z" },
      ],
      now,
    );

    expect(result.map((prediction) => prediction.lineName)).toEqual(["skewed"]);
  });
});

describe("departureDueMinutes", () => {
  const expectedArrival = "2026-07-28T22:43:00.000Z";

  it("ages off the arrival's own time rather than a rendered figure", () => {
    expect(
      departureDueMinutes(expectedArrival, new Date("2026-07-28T22:40:00.000Z")),
    ).toBe(3);
    expect(
      departureDueMinutes(expectedArrival, new Date("2026-07-28T22:42:10.000Z")),
    ).toBe(1);
    expect(
      departureDueMinutes(expectedArrival, new Date("2026-07-28T22:43:30.000Z")),
    ).toBeLessThanOrEqual(0);
  });

  it("reports an unreadable arrival as unknown rather than as a number", () => {
    expect(departureDueMinutes("soon", new Date("2026-07-28T22:40:00.000Z"))).toBe(
      null,
    );
  });
});

describe("busDeparturesFreshness", () => {
  const generatedAt = "2026-07-28T22:40:00.000Z";

  it("names a check's age once it is old enough to matter", () => {
    expect(
      busDeparturesFreshness(generatedAt, new Date("2026-07-28T22:40:20.000Z")),
    ).toEqual({ state: "live", ageMinutes: 0 });
    expect(
      busDeparturesFreshness(generatedAt, new Date("2026-07-28T22:41:10.000Z")),
    ).toEqual({ state: "ageing", ageMinutes: 1 });
  });

  it("stops vouching for a countdown once the check is too old", () => {
    expect(
      busDeparturesFreshness(generatedAt, new Date("2026-07-28T22:42:30.000Z")),
    ).toEqual({ state: "out-of-date", ageMinutes: 2 });
  });

  it("treats an undatable check as out of date rather than as a fresh one", () => {
    expect(
      busDeparturesFreshness("", new Date("2026-07-28T22:40:00.000Z")),
    ).toEqual({ state: "out-of-date", ageMinutes: null });
  });
});

describe("shouldPollBusDepartures", () => {
  it("asks TfL again only while the card is open and the page is on screen", () => {
    expect(shouldPollBusDepartures({ open: true, documentVisible: true })).toBe(
      true,
    );
    expect(shouldPollBusDepartures({ open: true, documentVisible: false })).toBe(
      false,
    );
    expect(shouldPollBusDepartures({ open: false, documentVisible: true })).toBe(
      false,
    );
  });
});

describe("startBusDeparturesPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T22:40:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads once immediately, ticks the clock, and refreshes on cadence", async () => {
    const ticks: number[] = [];
    const loads: AbortSignal[] = [];
    const stop = startBusDeparturesPoll({
      onTick: (at) => ticks.push(at),
      load: async (signal) => {
        loads.push(signal);
      },
    });

    expect(loads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_TICK_MS);
    expect(ticks).toHaveLength(1);
    expect(loads).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_REFRESH_MS);
    expect(loads).toHaveLength(2);

    stop();
  });

  it("never overlaps loads", async () => {
    let started = 0;
    const stop = startBusDeparturesPoll({
      load: () =>
        new Promise<void>(() => {
          started += 1;
        }),
      onTick: () => {},
    });

    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_REFRESH_MS * 4);

    expect(started).toBe(1);
    stop();
  });

  it("stops ticking and aborts what is in flight when it is stopped", async () => {
    const ticks: number[] = [];
    const signals: AbortSignal[] = [];
    const stop = startBusDeparturesPoll({
      onTick: (at) => ticks.push(at),
      load: async (signal) => {
        signals.push(signal);
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve());
        });
      },
    });

    stop();

    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(BUS_DEPARTURES_REFRESH_MS * 4);
    expect(ticks).toEqual([]);
    expect(signals).toHaveLength(1);
  });
});

describe("GET /api/nearby-bus-departures", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T22:40:00.000Z"));
  });

  afterEach(() => {
    global.fetch = realFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns bounded fresh departures with stop distance and direction", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/StopPoint?")) {
        return Response.json({
          stopPoints: [
            {
              id: "490000123B",
              commonName: "Blackfriars Station",
              indicator: "Stop B",
              towards: "King's Cross",
              distance: 140.4,
            },
            {
              id: "490000123C",
              commonName: "Blackfriars Station",
              indicator: "Stop C",
              towards: "Waterloo",
              distance: 180,
            },
            {
              id: "490000123D",
              commonName: "Ludgate Circus",
              indicator: "Stop D",
              towards: "Aldwych",
              distance: 260,
            },
            {
              id: "490000123E",
              commonName: "Ludgate Circus",
              indicator: "Stop E",
              towards: "Elephant & Castle",
              distance: 310,
            },
            {
              id: "490000123F",
              commonName: "Fleet Street",
              indicator: "Stop F",
              towards: "Holborn",
              distance: 390,
            },
          ],
        });
      }
      if (url.includes("/Arrivals")) {
        return Response.json([
          {
            naptanId: "490000123B",
            lineName: "63",
            destinationName: "King's Cross",
            direction: "outbound",
            timestamp: "2026-07-28T22:39:40.000Z",
            expectedArrival: "2026-07-28T22:43:00.000Z",
          },
          {
            naptanId: "490000123B",
            lineName: "45",
            destinationName: "Clapham Park",
            direction: "inbound",
            timestamp: "2026-07-28T22:39:30.000Z",
            expectedArrival: "2026-07-28T22:45:00.000Z",
          },
          {
            naptanId: "490000123B",
            lineName: "17",
            destinationName: "Archway",
            direction: "outbound",
            timestamp: "2026-07-28T22:39:20.000Z",
            expectedArrival: "2026-07-28T22:47:00.000Z",
          },
          {
            naptanId: "490000123B",
            lineName: "40",
            destinationName: "Dulwich",
            direction: "inbound",
            timestamp: "2026-07-28T22:39:10.000Z",
            expectedArrival: "2026-07-28T22:49:00.000Z",
          },
          ...["C", "D", "E"].map((suffix, index) => ({
            naptanId: `490000123${suffix}`,
            lineName: String(100 + index),
            destinationName: ["Waterloo", "Aldwych", "Elephant & Castle"][index],
            direction: index % 2 === 0 ? "inbound" : "outbound",
            timestamp: "2026-07-28T22:39:30.000Z",
            expectedArrival: `2026-07-28T22:${44 + index}:00.000Z`,
          })),
          {
            naptanId: "490000123C",
            lineName: "stale",
            destinationName: "Old prediction",
            direction: "outbound",
            timestamp: "2026-07-28T22:37:00.000Z",
            expectedArrival: "2026-07-28T22:44:00.000Z",
          },
        ]);
      }
      return new Response("not found", { status: 404 });
    });

    const { GET } = await import("@/app/api/nearby-bus-departures/route");
    const response = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.31" } },
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.status).toBe("ready");
    expect(body.generatedAt).toBe("2026-07-28T22:40:00.000Z");
    expect(body.stops).toHaveLength(4);
    expect(body.stops[0]).toMatchObject({
      id: "490000123B",
      name: "Blackfriars Station",
      indicator: "Stop B",
      towards: "King's Cross",
      distanceM: 140,
    });
    expect(body.stops[0].departures).toHaveLength(3);
    expect(body.stops[0].departures[0]).toEqual({
      lineName: "63",
      destinationName: "King's Cross",
      direction: "outbound",
      expectedArrival: "2026-07-28T22:43:00.000Z",
      dueMinutes: 3,
    });
    expect(JSON.stringify(body)).not.toContain("stale");
    expect(JSON.stringify(body)).not.toContain("490000123F");

    const calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    const stopCall = calls.find((url) => url.includes("/StopPoint?"));
    expect(stopCall).toContain("stopTypes=NaptanPublicBusCoachTram");
    expect(stopCall).toContain("radius=500");
    expect(stopCall).toContain("modes=bus");
    const arrivalCalls = calls.filter((url) => url.includes("/Arrivals"));
    expect(arrivalCalls).toHaveLength(1);
    expect(decodeURIComponent(arrivalCalls[0])).toContain(
      "490000123B,490000123C,490000123D,490000123E",
    );
  });

  it("keeps its whole upstream budget inside its own function lifetime", async () => {
    const route = await import("@/app/api/nearby-bus-departures/route");

    expect(route.maxDuration * 1000).toBeGreaterThanOrEqual(
      BUS_UPSTREAM_BUDGET_MS,
    );
  });

  it("rejects invalid and non-London coordinates without calling TfL", async () => {
    global.fetch = vi.fn();
    const { GET } = await import("@/app/api/nearby-bus-departures/route");

    const invalid = await GET(
      new Request("http://localhost/api/nearby-bus-departures?lat=nope&lng=-0.1"),
    );
    const outside = await GET(
      new Request("http://localhost/api/nearby-bus-departures?lat=51.75&lng=-1.26"),
    );

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "lat and lng are required numbers.",
    });
    expect(outside.status).toBe(200);
    expect(await outside.json()).toMatchObject({ status: "unavailable", stops: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reports unavailable when TfL cannot return stops or fresh predictions", async () => {
    const { GET } = await import("@/app/api/nearby-bus-departures/route");

    global.fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const noStops = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.32" } },
      ),
    );
    expect(await noStops.json()).toMatchObject({ status: "unavailable", stops: [] });
    expect(noStops.headers.get("cache-control")).toBe("no-store");

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/StopPoint?")) {
        return Response.json({
          stopPoints: [
            {
              id: "490000123B",
              commonName: "Blackfriars Station",
              indicator: "Stop B",
              distance: 140,
            },
          ],
        });
      }
      return Response.json([
        {
          naptanId: "490000123B",
          lineName: "63",
          destinationName: "King's Cross",
          direction: "outbound",
          timestamp: "2026-07-28T22:35:00.000Z",
          expectedArrival: "2026-07-28T22:43:00.000Z",
        },
      ]);
    });
    const staleOnly = await GET(
      new Request(
        "http://localhost/api/nearby-bus-departures?lat=51.512&lng=-0.104",
        { headers: { "x-forwarded-for": "198.51.100.33" } },
      ),
    );
    expect(await staleOnly.json()).toMatchObject({ status: "unavailable", stops: [] });
  });
});
