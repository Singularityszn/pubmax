// @vitest-environment jsdom

// Last orders never keeps a clock reading past its minute. The door promotes
// itself at 21:30 and quietens at 04:00 while Tonight stays open, and reads
// the clock again when a tab comes back. The Get home line keeps the raw train
// answer, words it against the live clock, and asks for it again on a timer.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LastTrainResult } from "@/lib/tfl";

// Each read takes the next scripted step: a network answer, a cached copy
// handed back after a failed network read, a failure, or a read that never ends.
type Step =
  | { kind: "network"; value: unknown }
  | { kind: "snapshot"; value: unknown }
  | { kind: "failed" }
  | { kind: "pending" };

const surface = vi.hoisted(() => ({
  steps: [] as Step[],
  calls: 0,
  keys: [] as string[],
}));

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson: async (key: string, _options: unknown, apply: (value: unknown, source: "network" | "snapshot") => void) => {
    const step = surface.steps[Math.min(surface.calls, surface.steps.length - 1)] ?? { kind: "failed" };
    surface.calls += 1;
    surface.keys.push(key);
    if (step.kind === "pending") return new Promise(() => {});
    await Promise.resolve();
    if (step.kind === "failed") return "failed";
    apply(step.value, step.kind);
    return step.kind;
  },
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));

import TonightLastOrdersDoor from "@/app/tonight/TonightLastOrdersDoor";
import {
  GET_HOME_MAX_AGE_MS,
  GET_HOME_REFRESH_MS,
  getHomeObservedAt,
  useTonightGetHome,
  type GetHome,
} from "@/app/tonight/useTonightGetHome";
import { useLastOrdersVenueIds, type LastOrdersVenueIds } from "@/components/map/pubmap/useLastOrdersVenueIds";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  surface.steps = [];
  surface.calls = 0;
  surface.keys = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the door", () => {
  const door = () => container.querySelector('[data-testid="last-orders-door"]');

  async function mountAt(iso: string): Promise<void> {
    vi.setSystemTime(new Date(iso));
    act(() => {
      root.render(
        createElement(TonightLastOrdersDoor, { origin: null, near: null, onShareLocation: () => {}, locating: false }),
      );
    });
    await flush();
  }

  it("leads from 21:30 without a reload, and quietens again at 04:00", async () => {
    // Friday 30 October 2026, GMT, so the Z instant is the London wall clock.
    await mountAt("2026-10-30T21:29:00Z");
    expect(door()?.getAttribute("data-late")).toBeNull();
    await flush(60_000);
    expect(door()?.getAttribute("data-late")).toBe("true");

    vi.setSystemTime(new Date("2026-10-31T03:59:40Z"));
    await flush(30_000);
    expect(door()?.getAttribute("data-late")).toBeNull();
  });

  it("reads the clock again when a slept tab comes back", async () => {
    await mountAt("2026-10-30T20:00:00Z");
    expect(door()?.getAttribute("data-late")).toBeNull();
    // The tab slept: wall time moved on, its timers did not fire.
    vi.setSystemTime(new Date("2026-10-30T22:10:00Z"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(door()?.getAttribute("data-late")).toBe("true");
  });
});

describe("the Get home line", () => {
  const ORIGIN = { lat: 51.5136, lng: -0.1365 };
  let seen: GetHome | null = null;

  function Probe({ now }: { now: Date }) {
    seen = useTonightGetHome(ORIGIN, now);
    return null;
  }

  function answer(leaveByIso: string, generatedAt: string, disruption: string | null = null): LastTrainResult {
    return {
      station: { id: "940GZZLUOXC", name: "Oxford Circus", distanceM: 300 },
      trains: [{ lineId: "victoria", lineName: "Victoria", colour: "#0098d4", clock: "00:05", pastMidnight: true }],
      generatedAt,
      decision: {
        decision: "order_one_more",
        leaveByIso,
        stationName: "Oxford Circus",
        lineNames: ["Victoria"],
        disruptionSummary: disruption,
        walkMinutesEstimate: 5,
        bufferMinutes: 5,
        destinationLabel: null,
        live: true,
      },
    };
  }

  async function renderAt(iso: string): Promise<void> {
    vi.setSystemTime(new Date(iso));
    act(() => root.render(createElement(Probe, { now: new Date(iso) })));
    await flush();
  }

  it("words a held answer against the clock, so a passed deadline says so", async () => {
    surface.steps = [{ kind: "network", value: answer("2026-10-30T23:40:00Z", "2026-10-30T23:29:00Z") }];
    await renderAt("2026-10-30T23:30:00Z");
    expect(seen).toMatchObject({ status: "ready", summary: { trainLine: "Last train from Oxford Circus 00:05. Leave in 10 min." } });

    // Same answer, later clock (still inside its age limit): no new read, and
    // the sentence moves.
    await renderAt("2026-10-30T23:34:00Z");
    expect(seen).toMatchObject({
      status: "ready",
      summary: { trainLine: "Last train from Oxford Circus 00:05. Leave in 6 min." },
    });
    expect(surface.calls).toBe(1);
  });

  it("asks for the answer again on a timer, so a new disruption reaches the line", async () => {
    surface.steps = [
      { kind: "network", value: answer("2026-10-30T23:40:00Z", "2026-10-30T23:00:00Z") },
      { kind: "network", value: answer("2026-10-30T23:40:00Z", "2026-10-30T23:03:00Z", "Victoria line: severe delays.") },
    ];
    await renderAt("2026-10-30T23:00:00Z");
    expect(seen).toMatchObject({ status: "ready", summary: { statusLine: "Victoria line good service." } });
    await flush(GET_HOME_REFRESH_MS);
    expect(surface.calls).toBe(2);
    expect(seen).toMatchObject({ status: "ready", summary: { statusLine: "Victoria line: severe delays." } });
  });

  it("names no time when there is no answer", async () => {
    surface.steps = [{ kind: "network", value: { station: null, trains: [], error: "unavailable" } }];
    await renderAt("2026-10-30T23:00:00Z");
    expect(seen).toEqual({ status: "none" });
  });

  it("words a passed leave-by time against the live clock", async () => {
    surface.steps = [{ kind: "network", value: answer("2026-10-30T23:32:00Z", "2026-10-30T23:28:00Z") }];
    await renderAt("2026-10-30T23:30:00Z");
    expect(seen).toMatchObject({ summary: { trainLine: "Last train from Oxford Circus 00:05. Leave in 2 min." } });
    await renderAt("2026-10-30T23:33:00Z");
    expect(seen).toMatchObject({
      status: "ready",
      summary: { trainLine: "Last train from Oxford Circus 00:05. Leave-by time has passed." },
    });
  });

  it("says the time is out of date when a refresh hangs past the age limit", async () => {
    surface.steps = [
      { kind: "network", value: answer("2026-10-31T00:10:00Z", "2026-10-30T23:00:00Z") },
      { kind: "pending" },
    ];
    await renderAt("2026-10-30T23:00:00Z");
    expect(seen?.status).toBe("ready");
    // The refresh starts and never answers; the clock passes the limit.
    await flush(GET_HOME_REFRESH_MS);
    expect(surface.calls).toBe(2);
    await renderAt(new Date(Date.parse("2026-10-30T23:00:00Z") + GET_HOME_MAX_AGE_MS + 60_000).toISOString());
    expect(seen).toEqual({ status: "stale" });
  });

  it("says the time is out of date when a failed refresh hands back an old cached copy", async () => {
    const old = answer("2026-10-31T00:10:00Z", "2026-10-30T23:00:00Z");
    surface.steps = [{ kind: "network", value: old }, { kind: "snapshot", value: old }];
    await renderAt("2026-10-30T23:05:00Z");
    expect(seen?.status).toBe("ready");
    await renderAt("2026-10-30T23:12:00Z");
    await flush(GET_HOME_REFRESH_MS);
    expect(surface.calls).toBeGreaterThanOrEqual(2);
    expect(seen).toEqual({ status: "stale" });
  });

  it("keeps a held time after failed refreshes and expires it on its original clock", async () => {
    surface.steps = [
      { kind: "network", value: answer("2026-10-31T00:10:00Z", "2026-10-30T23:00:00Z") },
      { kind: "failed" },
    ];
    await renderAt("2026-10-30T23:00:00Z");
    await flush(GET_HOME_REFRESH_MS + 1);
    await renderAt("2026-10-30T23:03:00.001Z");
    expect(seen).toMatchObject({ status: "ready", summary: { trainLine: expect.stringContaining("Oxford Circus") } });
    await flush(GET_HOME_REFRESH_MS + 1);
    await renderAt("2026-10-30T23:06:00.002Z");
    expect(seen).toEqual({ status: "stale" });
  });

  it("trusts a cached copy only as far as its own stamp", () => {
    expect(getHomeObservedAt({ generatedAt: "2026-10-30T23:00:00Z" }, "snapshot", 0)).toBe(Date.parse("2026-10-30T23:00:00Z"));
    expect(getHomeObservedAt({ generatedAt: "" }, "snapshot", 123)).toBeNull();
    expect(getHomeObservedAt({ generatedAt: "" }, "network", 123)).toBe(123);
  });
});

describe("the map filter's open set", () => {
  let mapSeen: LastOrdersVenueIds | null = null;

  function MapProbe({ on }: { on: boolean }) {
    mapSeen = useLastOrdersVenueIds(on);
    return null;
  }

  const hoursPack = {
    version: 1,
    readOn: "2026-10-05",
    rows: [
      ["venue-closes-2330", "Closes 23:30", 51.51, -0.13, "Mo-Su 12:00-23:30", ""],
      ["venue-closes-0100", "Closes 01:00", 51.51, -0.13, "Mo-Su 12:00-01:00", ""],
    ],
  };

  async function mapAt(iso: string, on: boolean): Promise<void> {
    vi.setSystemTime(new Date(iso));
    act(() => root.render(createElement(MapProbe, { on })));
    await flush();
  }

  it("is null only when off, and an empty set while the hours are still on their way", async () => {
    surface.steps = [{ kind: "pending" }];
    await mapAt("2026-10-30T22:45:00Z", false);
    expect(mapSeen).toEqual({ ids: null, reading: false, failed: false });
    await mapAt("2026-10-30T22:45:00Z", true);
    await flush(30_000);
    expect(mapSeen?.reading).toBe(true);
    expect(mapSeen?.ids).not.toBeNull();
    expect(mapSeen?.ids?.size).toBe(0);
  });

  it("says so when the hours cannot be read, and shows no pin as open", async () => {
    surface.steps = [{ kind: "failed" }];
    await mapAt("2026-10-30T22:45:00Z", true);
    expect(mapSeen?.failed).toBe(true);
    expect(mapSeen?.reading).toBe(false);
    expect(mapSeen?.ids?.size).toBe(0);
  });

  it("drops a pub as its half hour runs out, also in a tab that slept", async () => {
    surface.steps = [{ kind: "network", value: hoursPack }];
    await mapAt("2026-10-30T22:55:00Z", true);
    expect([...(mapSeen?.ids ?? [])].sort()).toEqual(["venue-closes-0100", "venue-closes-2330"]);
    // A minute on, the same pubs are open: the same set, so no pin redraws.
    const before = mapSeen?.ids;
    vi.setSystemTime(new Date("2026-10-30T22:56:00Z"));
    await flush(60_000);
    expect(mapSeen?.ids).toBe(before);
    // The tab sleeps past 23:00: wall time moves, its timers do not fire.
    vi.setSystemTime(new Date("2026-10-30T23:05:00Z"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect([...(mapSeen?.ids ?? [])]).toEqual(["venue-closes-0100"]);
    expect(mapSeen?.ids).not.toBe(before);
  });
});
