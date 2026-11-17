import { afterEach, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { fairPintOpacity, wireFairPintPaint } from "@/components/map/fairpint/fairPintPaint";
import { setFairPintSession } from "@/lib/fairPint";

afterEach(() => { setFairPintSession(false); vi.unstubAllGlobals(); });
it.each<[number | null, number, number]>([[600, 500, 0.25], [600, 700, 1], [null, 800, 0.25], [2147483647, 800, 0.25]])(
  "fades evidence %s under ceiling %s to %s", (listed, ceiling, expected) => {
    expect(fairPintOpacity(listed, ceiling)).toBe(expected);
  },
);
it("updates feature state per frame, restores once, and leaves inactive paint alone", () => {
  let frame: FrameRequestCallback = () => {};
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback) => { frame = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const values = new Map<string, unknown>();
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const paint = vi.fn((id: string, key: string, value: unknown) => values.set(id + key, value));
  const state = vi.fn();
  const map = {
    getLayer: () => ({}), getSource: () => ({}),
    getPaintProperty: (id: string, key: string) => values.get(id + key),
    setPaintProperty: paint, setFeatureState: state, removeFeatureState: vi.fn(),
    querySourceFeatures: () => [{ id: 1, properties: { fairPence: 600 } }, { id: 2, properties: { cluster: true, minFairPence: 600 } }, { id: 3, properties: { cluster: true } }],
    on: (event: string, fn: (...args: unknown[]) => void) => listeners.set(event, fn),
    off: () => {},
  } as unknown as MapLibreMap;
  setFairPintSession(true, 500);
  wireFairPintPaint(map); frame(0);
  expect(state.mock.calls.map((call) => call[1])).toEqual(Array(3).fill({ fairPintOpacity: 0.25 }));
  paint.mockClear(); state.mockClear();
  setFairPintSession(true, 700); frame(16);
  expect(paint).not.toHaveBeenCalled();
  expect(state.mock.calls.map((call) => call[0].id)).toEqual([1, 2]);
  expect(state.mock.calls.map((call) => call[1])).toEqual(Array(2).fill({ fairPintOpacity: 1 }));
  setFairPintSession(false);
  paint("pubs-point", "icon-opacity", 0.6); paint.mockClear();
  listeners.get("idle")!();
  expect(paint).not.toHaveBeenCalled();
  listeners.get("remove")!();
  expect(values.get("pubs-pointicon-opacity")).toBe(0.6);
});
