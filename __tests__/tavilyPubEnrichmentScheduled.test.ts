import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runCityEnrichment } = vi.hoisted(() => ({
  runCityEnrichment: vi.fn(),
}));

vi.mock("@/scripts/lib/tavilyPubEnrichment.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/scripts/lib/tavilyPubEnrichment.mjs")>();
  return {
    ...actual,
    runCityEnrichment,
  };
});

import {
  BRISTOL_CRON_QUERY_CAP,
  BRISTOL_CRON_WALL_MS,
  runScheduledCityEnrichment,
  SEARCH_CRON_QUERY_CAP,
} from "@/lib/tavilyPubEnrichment.server";

function enrichmentOk(city: string, maxQueries: number) {
  return {
    city,
    totalPubs: 10,
    startIndex: 0,
    nextIndex: maxQueries,
    queriesSpent: maxQueries,
    creditsSpent: maxQueries,
    matchedPubs: maxQueries,
    prices: [],
    pages: [],
    delegatedChains: [],
    complete: false,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  runCityEnrichment.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runScheduledCityEnrichment", () => {
  it("bounds Bristol to the smaller cron cap on Bristol rotation nights", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, maxQueries }) =>
      enrichmentOk(city, maxQueries),
    );

    const result = await runScheduledCityEnrichment({ apiKey: "test-key" });

    expect(result.primaryCity).toBe("bristol");
    const bristolCall = runCityEnrichment.mock.calls.find((call) => call[0].city === "bristol");
    expect(bristolCall?.[0].maxQueries).toBe(BRISTOL_CRON_QUERY_CAP);
    expect(result.queriesSpent).toBeGreaterThan(BRISTOL_CRON_QUERY_CAP);
    expect(result.cityRuns?.some((run) => run.city === "london" && run.ok)).toBe(true);
  });

  it("isolates Bristol failure and still enriches spillover cities", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, maxQueries }) => {
      if (city === "bristol") {
        const error = new Error("Upstream 504");
        (error as Error & { partial?: unknown }).partial = {
          city: "bristol",
          nextIndex: 2,
          queriesSpent: 2,
          creditsSpent: 2,
          prices: [],
          pages: [{ osmId: "node/1" }],
          delegatedChains: [],
        };
        throw error;
      }
      return enrichmentOk(city, maxQueries);
    });

    const result = await runScheduledCityEnrichment({ apiKey: "test-key" });

    expect(result.primaryCity).toBe("bristol");
    expect(result.cityRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ city: "bristol", ok: false, queriesSpent: 2 }),
        expect.objectContaining({ city: "london", ok: true, queriesSpent: expect.any(Number) }),
      ]),
    );
    expect(result.queriesSpent).toBeGreaterThan(2);
  });

  it("still throws when a non-Bristol primary city fails", async () => {
    vi.setSystemTime(new Date("2026-07-26T03:15:00.000Z"));
    runCityEnrichment.mockRejectedValue(new Error("Upstream 503"));

    await expect(runScheduledCityEnrichment({ apiKey: "test-key" })).rejects.toThrow(
      "Upstream 503",
    );
    expect(runCityEnrichment).toHaveBeenCalledTimes(1);
  });

  it("applies the Bristol wall-clock bound on Bristol rotation nights", async () => {
    vi.setSystemTime(new Date("2026-07-29T03:15:00.000Z"));
    runCityEnrichment.mockImplementation(async ({ city, maxQueries }) => {
      if (city === "bristol") {
        return new Promise(() => {});
      }
      return enrichmentOk(city, maxQueries);
    });

    const resultPromise = runScheduledCityEnrichment({ apiKey: "test-key" });
    await vi.advanceTimersByTimeAsync(BRISTOL_CRON_WALL_MS + 1);
    const result = await resultPromise;

    expect(result.cityRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          city: "bristol",
          ok: false,
          error: expect.stringContaining(String(BRISTOL_CRON_WALL_MS)),
        }),
        expect.objectContaining({ city: "london", ok: true }),
      ]),
    );
  });
});

describe("cron caps", () => {
  it("keeps Bristol below the default nightly cap", () => {
    expect(BRISTOL_CRON_QUERY_CAP).toBeLessThan(SEARCH_CRON_QUERY_CAP);
  });
});
