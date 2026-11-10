// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";

import { installPalPicks } from "@/components/map/canvas/palPicks";
import { applyPalMapCommand, groundPalMapResult, resetPalMap } from "@/lib/palMapCommands";

vi.mock("maplibre-gl", () => ({
  Marker: class {
    constructor(private options: { element: HTMLElement }) {}
    setLngLat() { return this; }
    addTo() { document.body.append(this.options.element); return this; }
    remove() { this.options.element.remove(); }
  },
}));
vi.mock("@/components/map/canvas/tokens", () => ({
  readTokens: () => ({ paper: "#ffffff", inkDeep: "#000000" }),
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  resetPalMap();
  performance.clearMarks("pubmax:pal-picks-painted");
  vi.unstubAllGlobals();
});

it("reports native paint completion for every pick instead of delayed animation callbacks", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  type PaintEntry = { element: Element; renderTime: number };
  let reportPaint!: (list: { getEntries: () => PaintEntry[] }) => void;
  vi.stubGlobal("PerformanceObserver", class {
    static supportedEntryTypes = ["element"];
    constructor(callback: typeof reportPaint) { reportPaint = callback; }
    observe() {}
    disconnect() {}
  });
  const layers = new Map<string, { id: string }>();
  const container = document.createElement("div");
  const map = {
    getContainer: () => container,
    getStyle: () => ({ layers: [...layers.values()] }),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    project: () => ({ x: 100, y: 100 }),
    on: () => {}, off: () => {}, triggerRepaint: () => {},
  } as unknown as MapLibreMap;
  groundPalMapResult(["pub-1", "pub-2"]);
  applyPalMapCommand({ kind: "showPicks", picks: [
    { venueId: "pub-1", name: "The Pub", lat: 51.5, lng: -0.1, number: 1 },
    { venueId: "pub-2", name: "Another Pub", lat: 51.51, lng: -0.11, number: 2 },
  ] });
  dispose = installPalPicks(map, { frame: () => {}, open: () => {} });

  // Native Element Timing reports actual text paint, even when the map's
  // animation callbacks run before or after the text reaches the screen.
  frames.shift()!(100);
  frames.shift()!(116);
  expect(performance.getEntriesByName("pubmax:pal-picks-painted")).toHaveLength(0);
  const buttons = document.querySelectorAll(".palPick");
  reportPaint({ getEntries: () => [{ element: buttons[0]!, renderTime: 200 }] });
  expect(performance.getEntriesByName("pubmax:pal-picks-painted")).toHaveLength(0);
  reportPaint({ getEntries: () => [{ element: buttons[1]!, renderTime: 240 }] });
  expect(performance.getEntriesByName("pubmax:pal-picks-painted").at(-1)?.startTime).toBe(240);
});
