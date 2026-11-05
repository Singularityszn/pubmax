import type { Page, Request } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { aggregatePerfMetric, loadPerfRoute, waitForQuietNetwork, type PerfRoute } from "../e2e/helpers/perfMeasurement";
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


// Double the browser boundary, not the helper or its assertion implementation.
function navigationPage(status: number): Page {
  const locator = {
    _apiName: "Locator",
    first() { return this; },
    async _expect() { return { matches: true }; },
  };
  return {
    goto: async () => ({ status: () => status }),
    locator: () => locator,
    evaluate: async () => 125,
  } as unknown as Page;
}

describe("route navigation status", () => {
  const retiredRoute = PERFORMANCE_BUDGETS.routes.find(
    (route) => route.path === "/area/clapham/drink/guinness",
  )!;

  it.each(
    [null, "200", "404", "500", 500, 301, 307, 0, 200.5, true, false, [], {}]
      .map((expectedStatus) => ({ expectedStatus })),
  )(
    "rejects configured expectedStatus $expectedStatus before navigating to a server that returns 500",
    async ({ expectedStatus }) => {
      const page = navigationPage(500);
      const goto = vi.spyOn(page, "goto");
      const route = JSON.parse(JSON.stringify({
        path: "/about",
        readySelector: "main",
        expectedStatus,
      })) as PerfRoute;

      await expect(loadPerfRoute(page, route)).rejects.toThrow(
        "expectedStatus must be numeric 200 or 404",
      );
      expect(goto).not.toHaveBeenCalled();
    },
  );

  it("rejects an explicit undefined status before navigation", async () => {
    const page = navigationPage(500);
    const goto = vi.spyOn(page, "goto");

    await expect(loadPerfRoute(page, {
      path: "/about",
      readySelector: "main",
      expectedStatus: undefined,
    })).rejects.toThrow("expectedStatus must be numeric 200 or 404");
    expect(goto).not.toHaveBeenCalled();
  });

  it("measures the configured retired URL when it returns HTTP 404", async () => {
    await expect(loadPerfRoute(navigationPage(404), retiredRoute)).resolves.toBe(125);
  });

  it("refuses a success response when the budget measures a retired page", async () => {
    await expect(loadPerfRoute(navigationPage(200), retiredRoute)).rejects.toThrow("must answer HTTP 404");
  });

  it("refuses an unexpected HTTP 404 on an ordinary page", async () => {
    await expect(loadPerfRoute(navigationPage(404), {
      path: "/about",
      readySelector: "main",
    })).rejects.toThrow("must answer HTTP 200");
  });

  it("still measures an ordinary successful page without a status override", async () => {
    await expect(loadPerfRoute(navigationPage(200), {
      path: "/about",
      readySelector: "main",
    })).resolves.toBe(125);
  });

  it("measures an explicit numeric HTTP 200", async () => {
    await expect(loadPerfRoute(navigationPage(200), {
      path: "/about",
      readySelector: "main",
      expectedStatus: 200,
    })).resolves.toBe(125);
  });

  it.each([undefined, 200, 404] as const)(
    "rejects HTTP 500 with valid expectedStatus %j",
    async (expectedStatus) => {
      await expect(loadPerfRoute(navigationPage(500), {
        path: "/about",
        readySelector: "main",
        ...(expectedStatus === undefined ? {} : { expectedStatus }),
      })).rejects.toThrow(`must answer HTTP ${expectedStatus ?? 200}`);
    },
  );
});
