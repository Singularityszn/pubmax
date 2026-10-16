// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import MapOpeningPreview from "@/components/map/MapOpeningPreview";
import {
  MAP_OPENING_FRAME_EVENT,
  MAP_OPENING_PREVIEW_CAMERA,
  MAP_OPENING_PREVIEW_RETRACT_EVENT,
  type MapOpeningFrame,
} from "@/lib/mapOpeningPreview";
import type { OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import { FIRST_PINS_SEEN_KEY, PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

const themeInit = readFileSync(join(process.cwd(), "public/theme-init.js"), "utf8");

function runThemeInit(pathname: string, search = "") {
  new Function("window", themeInit)({
    location: { pathname, search, hash: "", replace: () => {} },
    localStorage,
    sessionStorage,
    matchMedia: () => ({ matches: false }),
    navigator: { webdriver: false },
  });
}

const DISC: OpeningPreviewDisc = {
  id: 161,
  lng: -0.1325,
  lat: 51.5134,
  x: -50,
  y: 30,
  priceGbp: 5.2,
  figure: "£5.20",
  count: 93,
  badge: "93",
  ringBand: 2,
  shares: [0.1, 0.25, 0.3, 0.35],
  bands: [9, 23, 28, 33],
};

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.mapPreview;
  performance.clearMarks();
  delete (window as { __pubmaxOpeningFrame?: unknown }).__pubmaxOpeningFrame;
});

describe("the pre-paint gate in public/theme-init.js", () => {
  it("turns the preview on for a cold first visit to /map", () => {
    runThemeInit("/map");
    expect(document.documentElement.dataset.mapPreview).toBe("on");
  });

  it.each([
    ["another route", "/near", ""],
    ["a query naming another view", "/map", "?sel=venue-1"],
  ])("leaves it off for %s", (_label, pathname, search) => {
    runThemeInit(pathname, search);
    expect(document.documentElement.dataset.mapPreview).toBeUndefined();
  });

  it("leaves it off for a returning visitor, whose map does not open on the eager cell", () => {
    localStorage.setItem(FIRST_PINS_SEEN_KEY, "1");
    runThemeInit("/map");
    expect(document.documentElement.dataset.mapPreview).toBeUndefined();
  });

  it("leaves it off for a visitor whose remembered location moves the camera", () => {
    localStorage.setItem("pubmax:map-opening-location:v1", JSON.stringify({ lat: 51.5, lng: -0.1 }));
    runThemeInit("/map");
    expect(document.documentElement.dataset.mapPreview).toBeUndefined();
  });
});

describe("MapOpeningPreview", () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(async () => {
    if (root) await act(() => root!.unmount());
    root = null;
    host.remove();
  });

  async function mount(discs: OpeningPreviewDisc[] = [DISC]) {
    root = createRoot(host);
    await act(() => root!.render(createElement(MapOpeningPreview, { discs })));
  }

  it("ships the discs in the document, decorative, on the engine's camera", () => {
    const html = renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [DISC] }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`--map-preview-pitch:${MAP_OPENING_PREVIEW_CAMERA.pitch}deg`);
    expect(html).toContain("--x:-50px");
    expect(html).toContain("--y:30px");
    expect(html).toContain('elementtiming="map-first-price"');
    expect(html).toContain(">£5.20<");
    expect(html).toContain(">93<");
  });

  it("renders nothing when the build found no discs", () => {
    expect(renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [] }))).toBe("");
  });

  it("stands down when the map reveals its own pins", async () => {
    document.documentElement.dataset.mapPreview = "on";
    await mount();
    expect(document.documentElement.dataset.mapPreview).toBe("on");
    await act(() => {
      window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    });
    expect(document.documentElement.dataset.mapPreview).toBe("done");
  });

  it("stands down when the map says it cannot draw", async () => {
    document.documentElement.dataset.mapPreview = "on";
    await mount();
    await act(() => {
      window.dispatchEvent(new Event(MAP_OPENING_PREVIEW_RETRACT_EVENT));
    });
    expect(document.documentElement.dataset.mapPreview).toBe("done");
  });

  it("stands down the moment the frame the map will draw is not this one", async () => {
    document.documentElement.dataset.mapPreview = "on";
    await mount();
    const moved: MapOpeningFrame = {
      features: [],
      camera: { ...MAP_OPENING_PREVIEW_CAMERA, center: [-0.09, 51.51] },
    };
    await act(() => {
      window.dispatchEvent(new CustomEvent(MAP_OPENING_FRAME_EVENT, { detail: moved }));
    });
    expect(document.documentElement.dataset.mapPreview).toBe("done");
  });

  it("holds while the map has not yet said anything that contradicts it", async () => {
    document.documentElement.dataset.mapPreview = "on";
    await mount();
    const empty: MapOpeningFrame = { features: [], camera: { ...MAP_OPENING_PREVIEW_CAMERA } };
    await act(() => {
      window.dispatchEvent(new CustomEvent(MAP_OPENING_FRAME_EVENT, { detail: empty }));
    });
    expect(document.documentElement.dataset.mapPreview).toBe("on");
  });

  it("stands down at once if the map revealed before it hydrated", async () => {
    document.documentElement.dataset.mapPreview = "on";
    performance.mark(PINS_VISIBLE_EVENT);
    await mount();
    expect(document.documentElement.dataset.mapPreview).toBe("done");
  });

  it("never turns itself on for a visit the gate left off", async () => {
    await mount();
    await act(() => {
      window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    });
    expect(document.documentElement.dataset.mapPreview).toBeUndefined();
  });
});
