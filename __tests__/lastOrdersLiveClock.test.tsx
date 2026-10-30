// @vitest-environment jsdom

// Last orders never keeps a clock reading past its minute. The door promotes
// itself at 21:30 and quietens at 04:00 while Tonight stays open, and reads
// the clock again when a tab comes back. The Get home line keeps the raw train
// answer, words it against the live clock, and asks for it again on a timer.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LastTrainResult } from "@/lib/tfl";

const surface = vi.hoisted(() => ({
  answers: [] as unknown[],
  calls: 0,
}));

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson: async (_key: string, _options: unknown, apply: (value: unknown, source: "network") => void) => {
    const answer = surface.answers[Math.min(surface.calls, surface.answers.length - 1)];
    surface.calls += 1;
    await Promise.resolve();
    if (answer === undefined) return "failed";
    apply(answer, "network");
    return "network";
  },
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));

import TonightLastOrdersDoor from "@/app/tonight/TonightLastOrdersDoor";
import { GET_HOME_REFRESH_MS, useLastOrdersGetHome, type GetHome } from "@/app/tonight/useLastOrdersGetHome";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  surface.answers = [];
  surface.calls = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
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
    seen = useLastOrdersGetHome(ORIGIN, now);
    return null;
  }

  function answer(leaveByIso: string, disruption: string | null = null): LastTrainResult {
    return {
      station: { id: "940GZZLUOXC", name: "Oxford Circus", distanceM: 300 },
      trains: [{ lineId: "victoria", lineName: "Victoria", colour: "#0098d4", clock: "00:05", pastMidnight: true }],
      generatedAt: "2026-10-30T23:00:00Z",
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
    surface.answers = [answer("2026-10-30T23:40:00Z")];
    await renderAt("2026-10-30T23:30:00Z");
    expect(seen).toMatchObject({ status: "ready", summary: { trainLine: "Last train from Oxford Circus 00:05. Leave in 10 min." } });

    // Same answer, later clock: no new read, and the sentence moves.
    await renderAt("2026-10-30T23:45:00Z");
    expect(seen).toMatchObject({
      status: "ready",
      summary: { trainLine: "Last train from Oxford Circus 00:05. Leave-by time has passed." },
    });
    expect(surface.calls).toBe(1);
  });

  it("asks for the answer again on a timer, so a new disruption reaches the line", async () => {
    surface.answers = [answer("2026-10-30T23:40:00Z"), answer("2026-10-30T23:40:00Z", "Victoria line: severe delays.")];
    await renderAt("2026-10-30T23:00:00Z");
    expect(seen).toMatchObject({ status: "ready", summary: { statusLine: "Victoria line good service." } });
    await flush(GET_HOME_REFRESH_MS);
    expect(surface.calls).toBe(2);
    expect(seen).toMatchObject({ status: "ready", summary: { statusLine: "Victoria line: severe delays." } });
  });

  it("names no time when there is no answer", async () => {
    surface.answers = [{ station: null, trains: [], error: "unavailable" }];
    await renderAt("2026-10-30T23:00:00Z");
    expect(seen).toEqual({ status: "none" });
  });
});
