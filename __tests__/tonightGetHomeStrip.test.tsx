// @vitest-environment jsdom

// The location block's get-home strip words its answer against the live
// clock, reads it again on a timer, and shows no train time it cannot stand
// behind: nothing while loading, nothing for no answer, nothing once stale.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LastTrainResult } from "@/lib/tfl";

const surface = vi.hoisted(() => ({ answers: [] as (LastTrainResult | "pending")[], calls: 0 }));

vi.mock("@/lib/surfaceDataCache", () => ({
  loadSurfaceJson: async (_key: string, _options: unknown, apply: (value: unknown, source: "network") => void) => {
    const answer = surface.answers[Math.min(surface.calls, surface.answers.length - 1)];
    surface.calls += 1;
    if (answer === "pending") return new Promise(() => {});
    await Promise.resolve();
    if (!answer) return "failed";
    apply(answer, "network");
    return "network";
  },
}));
vi.mock("@/components/transport/DisruptionLine", () => ({ default: () => null }));

import TonightGetHomeStrip from "@/app/tonight/TonightGetHomeStrip";
import { GET_HOME_MAX_AGE_MS, GET_HOME_REFRESH_MS } from "@/app/tonight/useTonightGetHome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = { lat: 51.5152, lng: -0.1419 };
let container: HTMLDivElement;
let root: Root;

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

async function at(iso: string, advanceMs = 0): Promise<void> {
  vi.setSystemTime(new Date(iso));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(advanceMs);
  });
}

function strip(): string | null {
  return container.querySelector('[data-testid="tonight-get-home"]')?.textContent ?? null;
}

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

function mount(iso: string): Promise<void> {
  vi.setSystemTime(new Date(iso));
  act(() => root.render(createElement(TonightGetHomeStrip, { origin: ORIGIN })));
  return at(iso);
}

describe("the Tonight get-home strip", () => {
  it("moves its leave-by words with the clock, without a new read", async () => {
    surface.answers = [answer("2026-10-30T23:40:00Z", "2026-10-30T23:29:00Z")];
    await mount("2026-10-30T23:30:00Z");
    expect(strip()).toContain("Leave in 10 min.");
    // The live clock ticks every 30 s; the deadline passes inside the age limit.
    await at("2026-10-30T23:34:30Z", 30_000);
    expect(strip()).toContain("Leave in 5 min.");
    await at("2026-10-30T23:34:30Z", 6 * 60_000 - 30_000);
    expect(strip()).toBeNull();
  });

  it("says the leave-by time has passed once it has", async () => {
    surface.answers = [answer("2026-10-30T23:32:00Z", "2026-10-30T23:30:00Z")];
    await mount("2026-10-30T23:31:00Z");
    expect(strip()).toContain("Leave in 1 min.");
    await at("2026-10-30T23:33:00Z", 30_000);
    expect(strip()).toContain("Leave-by time has passed.");
  });

  it("reads the answer again on a timer, so a new disruption reaches the strip", async () => {
    surface.answers = [
      answer("2026-10-31T00:10:00Z", "2026-10-30T23:00:00Z"),
      answer("2026-10-31T00:10:00Z", "2026-10-30T23:03:00Z", "Victoria line: severe delays."),
    ];
    await mount("2026-10-30T23:00:00Z");
    expect(strip()).toContain("Victoria line good service.");
    await at("2026-10-30T23:03:00Z", GET_HOME_REFRESH_MS);
    expect(surface.calls).toBe(2);
    expect(strip()).toContain("Victoria line: severe delays.");
  });

  it("shows no train time once its answer is out of date and a refresh hangs", async () => {
    surface.answers = [answer("2026-10-31T00:10:00Z", "2026-10-30T23:00:00Z"), "pending"];
    await mount("2026-10-30T23:00:00Z");
    expect(strip()).toContain("Last train from Oxford Circus 00:05.");
    await at(new Date(Date.parse("2026-10-30T23:00:00Z") + GET_HOME_MAX_AGE_MS + 60_000).toISOString(), GET_HOME_REFRESH_MS);
    expect(strip()).toBeNull();
  });

  it("renders nothing for no answer", async () => {
    surface.answers = [];
    await mount("2026-10-30T23:00:00Z");
    expect(strip()).toBeNull();
  });
});
