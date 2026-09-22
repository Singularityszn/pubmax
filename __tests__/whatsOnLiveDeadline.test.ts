import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The live What's-On lane is a JSON-RPC POST to CityMCP, a third party we do not
// control, and it used to sit unbounded on the SERVER RENDER of /today. This
// spec holds the deal that replaced it: the render waits a bounded moment, the
// bundled spine stands either way, and the three outcomes a lane can have keep
// three separate names.
vi.mock("@/lib/citymcp/client", () => ({
  fetchThingsToDo: vi.fn(),
}));

import { fetchThingsToDo } from "@/lib/citymcp/client";
import { WEATHER_TOP_UP_RENDER_DEADLINE_MS } from "@/lib/weatherFreshness.server";
import {
  __resetWhatsOnLiveTopUp,
  loadWhatsOn,
  WHATS_ON_LIVE_RENDER_DEADLINE_MS,
} from "@/lib/whatsOnStore";
import routeBudgets from "@/perf/route-budgets.json";

const NOW = Date.parse("2026-07-11T20:00:00.000Z");
const mockFetch = vi.mocked(fetchThingsToDo);

/**
 * One CityMCP answer carrying a single opportunity, in the provider's own shape:
 * a mapped `kind`, a named place, and a labelled http source, which are the
 * three things `mapThingsToDoToRows` requires before it will keep a row.
 */
const answer = (title: string) => ({
  window: "tonight" as const,
  area: "London",
  asOf: "2026-07-11T19:30:00.000Z",
  opportunities: [
    {
      title,
      kind: "gig",
      startsAt: "2026-07-11T21:00:00.000Z",
      place: { name: "The Test Tavern" },
      source: { label: "Test Listings", url: "https://example.test/thing" },
    },
  ],
});

beforeEach(() => {
  __resetWhatsOnLiveTopUp();
  mockFetch.mockReset();
});

afterEach(() => {
  __resetWhatsOnLiveTopUp();
});

describe("live What's-On top-up render deadline", () => {
  it("is the route ceiling, so the live lane can never be why /today misses its budget", () => {
    expect(WHATS_ON_LIVE_RENDER_DEADLINE_MS).toBe(150);
  });

  it("serves the bundled spine and names the LAPSE when the provider is slower than the deadline", async () => {
    // A virtual clock, not a wall-clock race: advancing past the 20ms deadline
    // before the mocked 400ms provider settles makes the lapse deterministic
    // instead of leaving CI to guess whether "waited < 300ms" holds under load.
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(answer("slow")), 400)),
      );

      let settledAtDeadline = false;
      const pending = loadWhatsOn(
        {},
        { now: NOW, loadBaseline: () => [], liveDeadlineMs: 20 },
      ).then((value) => {
        settledAtDeadline = true;
        return value;
      });
      await vi.advanceTimersByTimeAsync(20);
      // The render is finished AT the deadline, said out loud: a build that
      // waited for the provider's 400ms instead would leave this false and
      // fail here, rather than hanging until the runner's timeout guesses why.
      expect(settledAtDeadline).toBe(true);
      const result = await pending;

      // A lane we stopped waiting for is not a lane that failed. Three findings,
      // three names.
      expect(result.revalidation).toEqual({
        status: "unmeasured",
        reason: "live-provider-deadline",
      });
      // The bundled spine is what a reader gets, never a fabricated night.
      expect(result.readStatus).toBe("ready");
      expect(result.rows).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still calls a lapsed lane a lapse and NOT a failure", async () => {
    mockFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(answer("slow")), 400)),
    );
    const result = await loadWhatsOn(
      {},
      { now: NOW, loadBaseline: () => [], liveDeadlineMs: 20 },
    );
    expect(result.revalidation).not.toEqual({
      status: "unmeasured",
      reason: "live-provider-failed",
    });
  });

  it("reports a provider that THREW as a failure, never as a deadline lapse", async () => {
    mockFetch.mockRejectedValue(new Error("CityMCP HTTP 503"));

    const result = await loadWhatsOn(
      {},
      { now: NOW, loadBaseline: () => [], liveDeadlineMs: 20 },
    );

    expect(result.revalidation).toEqual({
      status: "unmeasured",
      reason: "live-provider-failed",
    });
    expect(result.readStatus).toBe("ready");
  });

  it("serves the live rows unchanged when the provider answers inside the deadline", async () => {
    mockFetch.mockResolvedValue(answer("quick"));

    const result = await loadWhatsOn(
      {},
      { now: NOW, loadBaseline: () => [], liveDeadlineMs: 5_000 },
    );

    // "measured" is the whole claim here: the live lane ANSWERED and was merged.
    // Which rows survive the window and locality filters is owned by
    // __tests__/whatsOnStoreRoute.test.ts and is untouched by this change.
    expect(result.revalidation).toEqual({ status: "measured" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("waits for as long as the provider takes when the deadline is 0, which is what a cron wants", async () => {
    mockFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(answer("cron")), 60)),
    );

    const result = await loadWhatsOn(
      {},
      { now: NOW, loadBaseline: () => [], liveDeadlineMs: 0 },
    );

    expect(result.revalidation).toEqual({ status: "measured" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("shares ONE provider call across concurrent renders rather than opening two POSTs", async () => {
    mockFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(answer("shared")), 30)),
    );

    await Promise.all([
      loadWhatsOn({}, { now: NOW, loadBaseline: () => [], liveDeadlineMs: 5_000 }),
      loadWhatsOn({}, { now: NOW, loadBaseline: () => [], liveDeadlineMs: 5_000 }),
      loadWhatsOn({}, { now: NOW, loadBaseline: () => [], liveDeadlineMs: 5_000 }),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses a fake clock to separate the render deadline from provider completion", async () => {
    vi.useFakeTimers();
    try {
      let settled = 0;
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => {
              settled += 1;
              resolve(answer("completed after deadline"));
            }, 40),
          ),
      );

      const pending = loadWhatsOn(
        {},
        { now: NOW, loadBaseline: () => [], liveDeadlineMs: 5 },
      );
      await vi.advanceTimersByTimeAsync(5);
      const lapsed = await pending;
      expect(lapsed.revalidation).toEqual({
        status: "unmeasured",
        reason: "live-provider-deadline",
      });
      expect(settled).toBe(0);

      // Move past provider completion after the render has already returned.
      await vi.advanceTimersByTimeAsync(35);
      expect(settled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves an INJECTED lane on its own unbounded wait, so every existing caller is unchanged", async () => {
    mockFetch.mockRejectedValue(new Error("the default lane must not be reached"));

    const result = await loadWhatsOn(
      {},
      {
        now: NOW,
        loadBaseline: () => [],
        liveDeadlineMs: 1,
        fetchLive: async () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ rows: [], sourceObservedAt: "2026-07-11T19:00:00.000Z" }),
              50,
            ),
          ),
      },
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.revalidation).toEqual({ status: "measured" });
  });
});

// /today has exactly two third-party lanes on its server render, and one rule
// covers both: neither may be the reason the route misses its budget. Holding
// them to the ceiling ITSELF, read out of the tracked budgets file, is what
// stops a deadline drifting away from the number it exists to protect. The
// weather deadline was 700 ms against a 150 ms ceiling for four months.
describe("both third-party lanes on /today answer to the same ceiling", () => {
  const todayCeiling = (routeBudgets as {
    routes: { path: string; serverRenderMs: number }[];
  }).routes.find((row) => row.path === "/today")?.serverRenderMs;

  it("reads a real ceiling out of perf/route-budgets.json", () => {
    expect(todayCeiling).toBeTypeOf("number");
  });

  it("holds the live What's-On lane to it", () => {
    expect(WHATS_ON_LIVE_RENDER_DEADLINE_MS).toBe(todayCeiling);
  });

  it("holds the live weather lane to it", () => {
    expect(WEATHER_TOP_UP_RENDER_DEADLINE_MS).toBe(todayCeiling);
  });
});
