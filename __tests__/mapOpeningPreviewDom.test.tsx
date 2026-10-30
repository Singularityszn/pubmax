// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapOpeningPreview from "@/components/map/MapOpeningPreview";
import { DONUT_CAPTION_SCALE } from "@/lib/donutClusterGeometry";
import {
  MAP_OPENING_FRAME_EVENT,
  MAP_OPENING_PREVIEW_CAMERA,
  MAP_OPENING_PREVIEW_DONE_MARK,
  MAP_OPENING_PREVIEW_RETRACT_EVENT,
  MAP_OPENING_PREVIEW_TURN_EVENT,
  type MapOpeningFrame,
} from "@/lib/mapOpeningPreview";
import type { OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import type { OpeningGround } from "@/lib/mapOpeningSnapshot";
import {
  BASEMAP_DRAWN_EVENT,
  FIRST_PINS_SEEN_KEY,
  PINS_VISIBLE_EVENT,
} from "@/lib/performanceMarks";

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
  figureBand: 0,
  priceKey: 5200,
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
    performance.clearMarks();
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(async () => {
    if (root) await act(() => root!.unmount());
    root = null;
    host.remove();
    // Let an unmount's deferred stand-down land here, not in the next test.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  async function mount(discs: OpeningPreviewDisc[] = [DISC], ground: OpeningGround | null = null) {
    root = createRoot(host);
    await act(() => root!.render(createElement(MapOpeningPreview, { discs, ground })));
  }

  it("ships the discs in the document, decorative, on the engine's camera", () => {
    const html = renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [DISC] }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`--map-preview-pitch:${MAP_OPENING_PREVIEW_CAMERA.pitch}deg`);
    expect(html).toContain("--x:-50px");
    expect(html).toContain("--y:30px");
    expect(html).toContain('elementtiming="map-first-price"');
    expect(html).toContain(">£5.20<");
  });

  it("draws the canvas's disc: neutral, 'from' over the figure in its own band's ink, no count", () => {
    const html = renderToStaticMarkup(
      createElement(MapOpeningPreview, { discs: [DISC, { ...DISC, id: 257, figureBand: 2 }] }),
    );
    expect(html).toContain(">from<");
    expect(html).toContain("--figure-ink:var(--price-band-cheap-ink)");
    expect(html).toContain("--figure-ink:var(--price-band-expensive-ink)");
    // The map drops a caption a neighbour is in the way of; the document cannot
    // know which, so it draws no count at all.
    expect(html).not.toContain(">93<");
    expect(html).not.toContain("pubs<");
  });

  it("sizes 'from' as the canvas does", () => {
    const css = readFileSync(join(process.cwd(), "components/map/mapOpeningPreview.css"), "utf8");
    expect(css).toContain(`calc(var(--figure-size) * ${DONUT_CAPTION_SCALE})`);
    // The ring is neutral, as the canvas's is: no band, no band mix.
    expect(css).not.toMatch(/conic-gradient|--segments|--ring\b/);
  });

  it("renders nothing when the build found no discs", () => {
    expect(renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [] }))).toBe("");
  });

  function drawStreets() {
    performance.mark(BASEMAP_DRAWN_EVENT);
    window.dispatchEvent(new Event(BASEMAP_DRAWN_EVENT));
  }

  it("stands down when the map reveals its own pins over drawn streets", async () => {
    document.documentElement.dataset.mapPreview = "on";
    performance.mark(BASEMAP_DRAWN_EVENT);
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
    performance.mark(BASEMAP_DRAWN_EVENT);
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

  it("after the reveal, holds until the loading frame over the canvas lifts", async () => {
    // The picture under the discs holds the canvas hidden while it shows, so
    // standing down while the loading frame still covers the canvas would put
    // that frame back on screen between the preview and the map.
    const loading = document.createElement("div");
    loading.className = "mapLoading";
    document.body.append(loading);
    try {
      document.documentElement.dataset.mapPreview = "on";
      performance.mark(BASEMAP_DRAWN_EVENT);
      await mount();
      await act(() => {
        window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
      });
      expect(document.documentElement.dataset.mapPreview).toBe("on");
      await act(async () => {
        loading.remove();
        await Promise.resolve();
      });
      expect(document.documentElement.dataset.mapPreview).toBe("done");
      expect(performance.getEntriesByName(MAP_OPENING_PREVIEW_DONE_MARK)).toHaveLength(1);
    } finally {
      loading.remove();
    }
  });

  it("after the reveal, holds until the streets in view are drawn", async () => {
    // The loading frame can lift while the street tiles are still arriving;
    // standing down then showed the engine's pins on bare paper.
    document.documentElement.dataset.mapPreview = "on";
    await mount();
    await act(() => {
      window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
    });
    expect(document.documentElement.dataset.mapPreview).toBe("on");
    await act(() => drawStreets());
    expect(document.documentElement.dataset.mapPreview).toBe("done");
  });

  it("waits for both the lift and the streets, in either order", async () => {
    const loading = document.createElement("div");
    loading.className = "mapLoading";
    document.body.append(loading);
    try {
      document.documentElement.dataset.mapPreview = "on";
      await mount();
      await act(() => {
        window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
      });
      await act(() => drawStreets());
      expect(document.documentElement.dataset.mapPreview).toBe("on");
      await act(async () => {
        loading.remove();
        await Promise.resolve();
      });
      expect(document.documentElement.dataset.mapPreview).toBe("done");
    } finally {
      loading.remove();
    }
  });

  it("stands down after a ceiling when the streets never report", async () => {
    vi.useFakeTimers();
    try {
      document.documentElement.dataset.mapPreview = "on";
      await mount();
      await act(() => {
        window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
      });
      await act(() => {
        vi.advanceTimersByTime(2_999);
      });
      expect(document.documentElement.dataset.mapPreview).toBe("on");
      await act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(document.documentElement.dataset.mapPreview).toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns with the arrival turn instead of standing down", async () => {
    document.documentElement.dataset.mapPreview = "on";
    await mount();
    try {
      await act(() => {
        window.dispatchEvent(new CustomEvent(MAP_OPENING_PREVIEW_TURN_EVENT, { detail: MAP_OPENING_PREVIEW_CAMERA.bearing + 2.5 }));
      });
      expect(document.documentElement.dataset.mapPreview).toBe("on");
      expect(document.documentElement.style.getPropertyValue("--map-preview-bearing")).toBe("2.5deg");
    } finally {
      document.documentElement.style.removeProperty("--map-preview-bearing");
    }
  });

  it("stands down on the turn where the turned screen would see past the picture", async () => {
    // A 1024x768 jsdom window is far wider than the ground a phone picture covers.
    const ground: OpeningGround = {
      rect: { x: -322, y: -848, width: 644, height: 1356 },
      light: "/landing/map-opening/london-light.webp",
      dark: "/landing/map-opening/london-dark.webp",
    };
    document.documentElement.dataset.mapPreview = "on";
    document.documentElement.dataset.mapGround = "on";
    try {
      await mount([DISC], ground);
      await act(() => {
        window.dispatchEvent(new CustomEvent(MAP_OPENING_PREVIEW_TURN_EVENT, { detail: MAP_OPENING_PREVIEW_CAMERA.bearing + 4 }));
      });
      expect(document.documentElement.dataset.mapPreview).toBe("done");
    } finally {
      delete document.documentElement.dataset.mapGround;
    }
  });

  it("does not carry an interrupted handoff into a return to the map", async () => {
    // The first map revealed its pins and drew its streets, then the reader
    // left /map while the loading frame was still up. The marks outlive the
    // page; the preview must not, or a return would hand over a frame no map
    // has drawn yet.
    const loading = document.createElement("div");
    loading.className = "mapLoading";
    document.body.append(loading);
    try {
      document.documentElement.dataset.mapPreview = "on";
      performance.mark(PINS_VISIBLE_EVENT);
      performance.mark(BASEMAP_DRAWN_EVENT);
      await mount();
      expect(document.documentElement.dataset.mapPreview).toBe("on");
      await act(() => root!.unmount());
      root = null;
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(document.documentElement.dataset.mapPreview).toBe("done");
      // The return mounts a new preview over the same retained marks.
      await mount();
      expect(document.documentElement.dataset.mapPreview).toBe("done");
      expect(performance.getEntriesByName(BASEMAP_DRAWN_EVENT)).toHaveLength(1);
    } finally {
      loading.remove();
    }
  });

  it("is not stood down by React's development double mount", async () => {
    document.documentElement.dataset.mapPreview = "on";
    root = createRoot(host);
    await act(() =>
      root!.render(createElement(StrictMode, null, createElement(MapOpeningPreview, { discs: [DISC] }))),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.documentElement.dataset.mapPreview).toBe("on");
  });

  it("still stands down at once when the camera moves before the loading frame lifts", async () => {
    const loading = document.createElement("div");
    loading.className = "mapLoading";
    document.body.append(loading);
    try {
      document.documentElement.dataset.mapPreview = "on";
      await mount();
      await act(() => {
        window.dispatchEvent(new Event(PINS_VISIBLE_EVENT));
        window.dispatchEvent(new Event(MAP_OPENING_PREVIEW_RETRACT_EVENT));
      });
      expect(document.documentElement.dataset.mapPreview).toBe("done");
    } finally {
      loading.remove();
    }
  });
});

describe("the opening basemap picture under the discs", () => {
  const GROUND: OpeningGround = {
    rect: { x: -322, y: -848, width: 644, height: 1356 },
    light: "/landing/map-opening/london-light.webp?v=abc",
    dark: "/landing/map-opening/london-dark.webp?v=def",
  };

  it("ships in the document, decorative, on the discs' own camera, behind them", () => {
    const html = renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [DISC], ground: GROUND }));
    expect(html.indexOf('class="mapOpeningGround"')).toBeGreaterThanOrEqual(0);
    // Before the discs' layer in the document, and a sibling of it rather than
    // a child of its 3-D context, so it can never cut through a disc.
    expect(html.indexOf('class="mapOpeningGround"')).toBeLessThan(html.indexOf('class="mapOpeningPreview"'));
    expect(html).toMatch(/class="mapOpeningGround" aria-hidden="true"/);
    expect(html).toContain(`--map-preview-pitch:${MAP_OPENING_PREVIEW_CAMERA.pitch}deg`);
    expect(html).toContain("--x:-322px");
    expect(html).toContain("--y:-848px");
    expect(html).toContain("--w:644px");
    expect(html).toContain("--h:1356px");
    // Both themes are named; the stylesheet asks for the one in use only.
    expect(html).toContain("london-light.webp?v=abc");
    expect(html).toContain("london-dark.webp?v=def");
    expect(html).not.toContain("<img");
  });

  it("is left out when the build has no picture for this camera", () => {
    const html = renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [DISC], ground: null }));
    expect(html).not.toContain("mapOpeningGround");
    expect(html).toContain('class="mapOpeningPreview"');
  });

  it("is left out with the discs when the build found no discs", () => {
    expect(renderToStaticMarkup(createElement(MapOpeningPreview, { discs: [], ground: GROUND }))).toBe("");
  });
});
