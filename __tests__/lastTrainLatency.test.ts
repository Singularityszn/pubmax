import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/last-train/route";
import { __resetLastTrainStableCache } from "@/lib/lastTrainStableCache.server";

const realFetch = global.fetch;
const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("GET /api/last-train latency boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T22:00:00.000Z"));
    __resetLastTrainStableCache();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseServiceRoleKey;
    vi.useRealTimers();
  });

  it("returns an honest degraded answer within two seconds when TfL stalls", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException("upstream aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
        setTimeout(() => resolve(new Response("upstream still pending", { status: 503 })), 30_000);
      });
    });

    let response: Response | undefined;
    const request = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.90" },
      }),
    ).then((result) => {
      response = result;
      return result;
    });

    await vi.advanceTimersByTimeAsync(2_000);
    const settledWithinBudget = response !== undefined;

    // If a regression removes the deadline, let the route finish its timeout
    // path so this test remains deterministic while the red assertion records
    // the missed budget.
    await vi.advanceTimersByTimeAsync(30_000);
    const completed = await request;
    const body = await completed.json();

    expect(settledWithinBudget).toBe(true);
    expect(completed.status).toBe(200);
    expect(body.staticFallback).toBe(true);
    expect(body.trains).toEqual([]);
    expect(body.departures).toEqual([]);
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(body.error).toMatch(/Couldn't reach TfL/i);
    expect(completed.headers.get("cache-control")).toBe("no-store");
    expect(calls.filter((url) => url.includes("/StopPoint?")).length).toBe(1);
  });

  it("starts line timetable, arrivals, and status reads together and cuts them off", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/StopPoint?") && !url.includes("/Arrivals")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              stopPoints: [
                {
                  id: "940GZZLUOXC",
                  commonName: "Oxford Circus",
                  distance: 120,
                  lines: [
                    { id: "victoria", name: "Victoria" },
                    { id: "central", name: "Central" },
                  ],
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException("upstream aborted", "AbortError"));
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
        setTimeout(() => resolve(new Response("upstream still pending", { status: 503 })), 30_000);
      });
    });

    let response: Response | undefined;
    const request = GET(
      new Request("http://localhost/api/last-train?lat=51.5&lng=-0.12", {
        headers: { "x-forwarded-for": "198.51.100.91" },
      }),
    ).then((result) => {
      response = result;
      return result;
    });

    await vi.advanceTimersByTimeAsync(2_000);
    const settledWithinBudget = response !== undefined;
    const completed = await request;
    const body = await completed.json();

    expect(settledWithinBudget).toBe(true);
    expect(body.station).toEqual(
      expect.objectContaining({ id: "940GZZLUOXC", name: "Oxford Circus" }),
    );
    expect(body.staticFallback).toBeUndefined();
    expect(body.trains).toEqual([]);
    expect(body.departures).toEqual([]);
    expect(body.decision.decision).toBe("live_data_unavailable");
    expect(calls.some((url) => url.includes("/Line/victoria/Timetable/"))).toBe(true);
    expect(calls.some((url) => url.includes("/Line/central/Timetable/"))).toBe(true);
    expect(calls.some((url) => url.includes("/StopPoint/940GZZLUOXC/Arrivals"))).toBe(true);
    expect(calls.some((url) => url.includes("/Line/victoria%2Ccentral/Status"))).toBe(true);
  });
});
