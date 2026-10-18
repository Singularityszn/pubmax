import { afterEach, describe, expect, it, vi } from "vitest";

import { WEATHER_FETCH_TIMEOUT_MS, fetchNightAreaObservations } from "@/lib/weatherProvider";

// One hung Open-Meteo read used to hold the whole batch until the cron's own
// time limit, so nothing was written (reliability audit, 18 Oct 2026). Each
// default read now carries its own timeout.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("weather provider default fetch", () => {
  it("gives every area's read its own abort signal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNightAreaObservations();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      const init = (call as unknown as [string, RequestInit])[1];
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(WEATHER_FETCH_TIMEOUT_MS).toBeLessThan(60_000);
  });
});
