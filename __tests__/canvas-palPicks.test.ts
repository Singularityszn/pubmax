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

it("applies retained speaking focus on first installation and reinstallation", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const container = document.createElement("div");
  const layers = new Map<string, { id: string }>();
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
  applyPalMapCommand({ kind: "focusPick", number: 2 });
  const frame = vi.fn();
  dispose = installPalPicks(map, { frame, open: () => {} });
  expect([...document.querySelectorAll(".palPick[data-speaking]")].map((button) => button.textContent)).toEqual(["2"]);
  dispose();
  dispose = installPalPicks(map, { frame, open: () => {} });
  expect([...document.querySelectorAll(".palPick[data-speaking]")].map((button) => button.textContent)).toEqual(["2"]);
  frame.mockClear();
  applyPalMapCommand({ kind: "focusPick", number: 1 });
  expect([...document.querySelectorAll(".palPick[data-speaking]")].map((button) => button.textContent)).toEqual(["1"]);
  applyPalMapCommand({ kind: "focusPick", number: null });
  expect(document.querySelectorAll(".palPick[data-speaking]")).toHaveLength(0);
  expect(frame).not.toHaveBeenCalled();
});

it.each([390, 768, 1440].flatMap((width) =>
  ["left", "right", "top", "bottom"].map((edge) => ({ width, edge })),
))("keeps separated 44 px picks visible at the $edge edge at $width px", ({ width, edge }) => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const container = document.createElement("div");
  let viewportWidth = width;
  const height = 844;
  Object.defineProperties(container, {
    clientWidth: { get: () => viewportWidth },
    clientHeight: { value: height },
  });
  let group = { x: 28, y: 400 };
  let distant = { x: width - 28, y: 400 };
  const events = new Map<string, () => void>();
  const layers = new Map<string, { id: string }>();
  const project = (lng: number) => lng === 0 ? group : distant;
  const map = {
    getContainer: () => container,
    getStyle: () => ({ layers: [...layers.values()] }),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    removeLayer: (id: string) => layers.delete(id),
    project: ([lng]: number[]) => project(lng!),
    on: (name: string, callback: () => void) => events.set(name, callback),
    off: () => {}, triggerRepaint: () => {},
  } as unknown as MapLibreMap;
  const picks = Array.from({ length: 6 }, (_, index) => ({
    venueId: `pub-${index}`, name: `Pub ${index}`, lat: 51.5, lng: index === 5 ? 1 : 0, number: index + 1,
  }));
  groundPalMapResult(picks.map((pick) => pick.venueId));
  applyPalMapCommand({ kind: "showPicks", picks });
  const open = vi.fn();
  dispose = installPalPicks(map, { frame: () => {}, open });
  const check = () => {
    const positions = [...document.querySelectorAll<HTMLButtonElement>(".palPick")].map((button, index) => {
      const anchor = project(picks[index]!.lng);
      const x = Number.parseFloat(button.style.left);
      const y = Number.parseFloat(button.style.top);
      const line = button.parentElement!.querySelector("line")!;
      expect(Number(line.getAttribute("x1"))).toBe(0);
      expect(Number(line.getAttribute("y1"))).toBe(0);
      expect(Number(line.getAttribute("x2"))).toBe(x);
      expect(Number(line.getAttribute("y2"))).toBe(y);
      const position = { x: anchor.x + x, y: anchor.y + y };
      expect(position.x - 22).toBeGreaterThanOrEqual(-0.001);
      expect(position.x + 22).toBeLessThanOrEqual(viewportWidth + 0.001);
      expect(position.y - 22).toBeGreaterThanOrEqual(-0.001);
      expect(position.y + 22).toBeLessThanOrEqual(height + 0.001);
      return position;
    });
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        expect(Math.max(Math.abs(positions[a]!.x - positions[b]!.x), Math.abs(positions[a]!.y - positions[b]!.y)))
          .toBeGreaterThanOrEqual(44);
      }
    }
  };
  check();
  if (edge === "right") [group, distant] = [distant, group];
  if (edge === "top" || edge === "bottom") {
    group = { x: width / 2, y: edge === "top" ? 28 : height - 28 };
    distant = { x: width / 2, y: edge === "top" ? height - 28 : 28 };
  }
  events.get("move")!();
  check();
  viewportWidth -= 40;
  events.get("resize")!();
  check();
  document.querySelector<HTMLButtonElement>(".palPick")!.click();
  expect(open).toHaveBeenCalledWith("pub-0");
});
