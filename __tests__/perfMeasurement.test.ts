import type { Page, Request } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aggregatePerfMetric, measurePerfRedirect, waitForQuietNetwork } from "../e2e/helpers/perfMeasurement";
import { PERFORMANCE_BUDGETS, type BudgetMethod } from "../lib/performanceBudgets";

// The quiet window is scaled to the tracked network profile, so these cases
// name the wire they are about rather than inheriting whichever one ships. The
// figures below are the loopback ones the cases were written against.
const LOOPBACK: BudgetMethod = {
  ...PERFORMANCE_BUDGETS.method,
  network: {
    ...PERFORMANCE_BUDGETS.method.network,
    profile: "loopback",
    quietMs: 1_500,
    drainCeilingMs: 20_000,
    streamAfterMs: 20_000,
  },
};

type RequestEvent = "request" | "requestfinished" | "requestfailed";

describe("measurePerfRedirect", () => {
  const route = { path: "/discover", readySelector: "main", redirectsTo: "/social?tab=discover" };
  const pageFor = (location?: string, status = 308) => ({
    request: { get: vi.fn().mockResolvedValue({
      status: () => status,
      headers: () => location === undefined ? {} : { location },
      url: () => "http://localhost:3410/discover",
    }) },
  });

  it.each(["/social?tab=discover", "http://localhost:3410/social?tab=discover"])(
    "counts a valid redirect to %s without loading the page",
    async (location) => {
      const page = pageFor(location);
      const result = await measurePerfRedirect(page as unknown as Page, route);
      expect(result).toMatchObject({ requests: 1, jsDecodedKB: 0, lcpMs: 0 });
      expect(page.request.get).toHaveBeenCalledWith("/discover", expect.objectContaining({
        maxRedirects: 0, headers: { accept: expect.stringContaining("text/html") },
      }));
    },
  );

  it.each([undefined, "", "/social", "/social?tab=posts", "https://example.com/social?tab=discover"])(
    "rejects an absent or different destination: %s",
    async (location) => {
      await expect(measurePerfRedirect(pageFor(location) as unknown as Page, route)).rejects.toThrow();
    },
  );

  it("rejects a document response even when it carries the expected Location", async () => {
    await expect(measurePerfRedirect(pageFor(route.redirectsTo, 200) as unknown as Page, route)).rejects.toThrow();
  });
});

function fakePage() {
  const listeners = new Map<RequestEvent, Array<(request: Request) => void>>();
  const page = {
    on(event: RequestEvent, listener: (request: Request) => void) {
      const registered = listeners.get(event) ?? [];
      registered.push(listener);
      listeners.set(event, registered);
      return page;
    },
  };
  return {
    page: page as unknown as Page,
    emit(event: RequestEvent, request = {} as Request) {
      for (const listener of listeners.get(event) ?? []) listener(request);
    },
  };
}

describe("waitForQuietNetwork", () => {
  afterEach(() => vi.useRealTimers());

  it("returns after a fully idle quiet window", async () => {
    vi.useFakeTimers();
    const harness = fakePage();
    const waiting = waitForQuietNetwork(harness.page, LOOPBACK);

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toEqual({ drained: true });
  });

  it("calls a long-lived connection a stream without sitting out the whole ceiling", async () => {
    // /today holds one open for the life of the page. Paying the drain ceiling
    // for it cost 90 seconds on every load of that route, four loads per route,
    // which is most of a CI wall spent waiting for a connection that is not in
    // the figures anyway.
    vi.useFakeTimers();
    const harness = fakePage();
    const method: BudgetMethod = {
      ...LOOPBACK,
      network: { ...LOOPBACK.network, streamAfterMs: 5_000, drainCeilingMs: 60_000 },
    };
    const waiting = waitForQuietNetwork(harness.page, method);
    harness.emit("request", { url: () => "http://localhost/stream" } as Request);

    // Past streamAfterMs, plus the quiet window the wait still requires once
    // the stream stops counting as activity.
    await vi.advanceTimersByTimeAsync(5_000 + 1_500 + 400);

    // Well before the 60s ceiling.
    await expect(waiting).resolves.toEqual({
      drained: false,
      stillOpen: ["http://localhost/stream"],
    });
  });

  it("names a connection still open at the ceiling instead of failing the run", async () => {
    // A connection still open this long after the route was interactive is a
    // stream, not a resource: it started well past the counting boundary, so it
    // is not in the figures and cannot move them. It used to throw, which failed
    // a route for something outside its own measurement.
    vi.useFakeTimers();
    const harness = fakePage();
    const waiting = waitForQuietNetwork(harness.page, LOOPBACK);
    harness.emit("request", { url: () => "http://localhost/stream" } as Request);

    await vi.advanceTimersByTimeAsync(20_200);

    await expect(waiting).resolves.toEqual({
      drained: false,
      stillOpen: ["http://localhost/stream"],
    });
  });

  it("allows the final quiet window when a request drains just before the ceiling", async () => {
    vi.useFakeTimers();
    const harness = fakePage();
    const request = {} as Request;
    const waiting = waitForQuietNetwork(harness.page, LOOPBACK);
    harness.emit("request", request);

    await vi.advanceTimersByTimeAsync(19_000);
    harness.emit("requestfinished", request);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(waiting).resolves.toEqual({ drained: true });
  });
});

describe("the quiet window follows the tracked network profile", () => {
  it("waits longer on a throttled wire than on loopback", () => {
    // Not a preference: over a throttled wire an ordinary gap between two
    // requests is longer than a whole loopback load, so a loopback window would
    // call a route finished in the middle of its own waterfall.
    const shipped = PERFORMANCE_BUDGETS.method.network;
    expect(shipped.quietMs).toBeGreaterThan(LOOPBACK.network.quietMs);
    expect(shipped.drainCeilingMs).toBeGreaterThan(LOOPBACK.network.drainCeilingMs);
  });
});

describe("performance measurement aggregation", () => {
  it("keeps an absent metric unmeasured instead of treating it as zero", () => {
    expect(Number.isNaN(aggregatePerfMetric([Number.NaN, 700, 710]))).toBe(true);
  });
});
