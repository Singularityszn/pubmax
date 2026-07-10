import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-train/route";

const realFetch = global.fetch;
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIGINAL_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
  if (ORIGINAL_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  if (ORIGINAL_SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SUPABASE_SERVICE_ROLE_KEY;
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
    // Static fallback: bundled station near Westminster when TfL is down.
    expect(body.staticFallback).toBe(true);
    expect(body.station).toEqual(
      expect.objectContaining({ name: expect.any(String), distanceM: expect.any(Number) }),
    );
    expect(body.station.name).not.toBe("Nearest station");
    expect(body.nearestPubs).toEqual(expect.any(Array));
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(body.error).toMatch(/TfL/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("fails closed for non-London coordinates instead of querying TfL or London static stations", async () => {
    global.fetch = vi.fn(async () => new Response("should not be called", { status: 500 }));

    const res = await GET(new Request("http://localhost/api/last-train?lat=51.75&lng=-1.26"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.station).toBeNull();
    expect(body.trains).toEqual([]);
    expect(body.departures).toEqual([]);
    expect(body.nearestPubs).toEqual([]);
    expect(body.error).toMatch(/London pubs/i);
    expect(body.staticFallback).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("ignores legacy ?destination= so labels stay client-only", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const res = await GET(
      new Request(
        "http://localhost/api/last-train?lat=51.5&lng=-0.12&destination=Home%20station",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decision.destinationLabel).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not follow off-host TfL disambiguation URIs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

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
      if (url.includes("direction=outbound")) {
        return new Response(
          JSON.stringify({
            timetable: {
              routes: [
                {
                  schedules: [{ name: "Friday", lastJourney: { hour: "23", minute: "58" } }],
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/Line/victoria/Timetable/")) {
        return new Response(
          JSON.stringify({
            disambiguation: {
              disambiguationOptions: [
                { uri: "https://evil.example/Line/victoria/Timetable/940GZZLUOXC" },
                { uri: "http://api.tfl.gov.uk/Line/victoria/Timetable/940GZZLUOXC" },
                { uri: "https://api.tfl.gov.uk.evil.example/Line/victoria/Timetable/940GZZLUOXC" },
                {
                  uri: "https://api.tfl.gov.uk/Line/victoria/Timetable/940GZZLUOXC?direction=outbound",
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

    const res = await GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.10" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trains[0].clock).toBe("23:58");

    const calls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(calls.some((url) => url.includes("evil.example"))).toBe(false);
    expect(calls.some((url) => url.startsWith("http://api.tfl.gov.uk"))).toBe(false);
    expect(calls.some((url) => url.includes("direction=outbound"))).toBe(true);
  });

  it("rate-limits valid last-train lookups per hashed client IP", async () => {
    global.fetch = vi.fn(async () => new Response("service unavailable", { status: 503 }));

    const responses: Response[] = [];
    for (let i = 0; i < 21; i++) {
      responses.push(
        await GET(
          new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
            headers: { "x-forwarded-for": "198.51.100.20" },
          }),
        ),
      );
    }

    expect(responses.slice(0, 20).every((res) => res.status === 200)).toBe(true);
    expect(responses[20].status).toBe(429);
    expect(await responses[20].json()).toEqual({ error: "Too many requests, slow down." });
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
