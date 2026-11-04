// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useTonightGetHome } from "@/app/tonight/useTonightGetHome";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";
import type { LastTrainResult } from "@/lib/tfl";

const START = Date.parse("2026-10-30T23:00:00Z");
const ORIGIN = { lat: 51.5136, lng: -0.1365 };
const answer: LastTrainResult = {
  station: { id: "940GZZLUOXC", name: "Oxford Circus", distanceM: 300 },
  trains: [{ lineId: "victoria", lineName: "Victoria", colour: "#0098d4", clock: "00:05", pastMidnight: true }],
  generatedAt: new Date(START).toISOString(),
};
let container: HTMLDivElement;
let root: Root;
let available: boolean;

function Probe({ origin = ORIGIN }: { origin?: typeof ORIGIN }) {
  const result = useTonightGetHome(origin, new Date());
  return createElement("output", { "data-status": result.status }, result.status === "ready" ? result.summary.trainLine : result.status);
}

async function render(origin = ORIGIN): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe, { origin }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  clearSurfaceCache();
  available = true;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (!available) throw new Error("Offline");
    return Response.json(answer);
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearSurfaceCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps a last-train answer through an expired-cache refresh failure, then marks it stale", async () => {
  await render();
  expect(container.textContent).toContain("Oxford Circus");
  available = false;
  // Real timer callbacks can run after the snapshot's three-minute ceiling.
  vi.setSystemTime(START + 1);
  await act(async () => { await vi.advanceTimersByTimeAsync(180_100); });
  await render();
  expect(container.querySelector("output")?.dataset.status).toBe("ready");
  expect(container.textContent).toContain("Oxford Circus");
  await act(async () => { await vi.advanceTimersByTimeAsync(180_100); });
  await render();
  expect(container.querySelector("output")?.dataset.status).toBe("stale");
  expect(container.textContent).not.toContain("Oxford Circus");
});

it("does not retain a held answer for a different origin after its read fails", async () => {
  await render();
  available = false;
  await render({ lat: 51.52, lng: -0.12 });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  await render({ lat: 51.52, lng: -0.12 });
  expect(container.querySelector("output")?.dataset.status).toBe("none");
  expect(container.textContent).not.toContain("Oxford Circus");
});
