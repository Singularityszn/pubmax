import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-train/route";

const realFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
});

describe("GET /api/last-train", () => {
  it("400s when lat/lng are missing or invalid", async () => {
    const res = await GET(new Request("http://localhost/api/last-train"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "lat and lng are required numbers." });
  });

  it("returns live_data_unavailable gracefully when TfL StopPoint lookup fails", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station).toBeNull();
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(body.error).toMatch(/TfL/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes destination through without persisting it (session-only label)", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(
      new Request(
        "http://localhost/api/last-train?lat=51.5&lng=-0.12&destination=Home%20station",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision.destinationLabel).toBe("Home station");
  });

  it("resolves a post-midnight last train against the prior service day", async () => {
    vi.useFakeTimers();
    // Saturday 00:15 Europe/London (BST): still Friday night's service window.
    vi.setSystemTime(new Date("2026-07-10T23:15:00.000Z"));

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/StopPoint?")) {
        return new Response(
          JSON.stringify({
            stopPoints: [
              {
                id: "940GZZLUOXC",
                commonName: "Oxford Circus",
                distance: 210,
                lat: 51.515,
                lon: -0.142,
                lines: [{ id: "victoria", name: "Victoria" }],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Line/victoria/Timetable/")) {
        return new Response(
          JSON.stringify({
            timetable: {
              routes: [
                {
                  schedules: [{ name: "Friday", lastJourney: { hour: "24", minute: "28" } }],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Arrivals")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/Line/victoria/Status")) {
        return new Response(
          JSON.stringify([
            {
              id: "victoria",
              name: "Victoria",
              lineStatuses: [{ statusSeverityDescription: "Good Service" }],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station?.name).toBe("Oxford Circus");
    expect(body.trains).toHaveLength(1);
    expect(body.trains[0].clock).toBe("00:28");
    expect(body.trains[0].pastMidnight).toBe(true);
    expect(body.decision.decision).not.toBe("live_data_unavailable");
    expect(body.decision.leaveByIso).toBeTruthy();
  });
});
