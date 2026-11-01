// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightPintBelt from "@/app/tonight/TonightPintBelt";
import { beltLapMs, beltPace, beltPerimeter, beltPoint, type BeltTrack } from "@/lib/pintBelt";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";

// Tonight's cheapest pints ride a belt of beer mats from 641px
// (app/tonight/TonightPintBelt.tsx, lib/pintBelt.ts).

const TRACK: BeltTrack = { width: 360, height: 260, mat: 112 };

describe("the belt's loop", () => {
  it("starts at the left end of the top straight and runs clockwise", () => {
    // radius 74, ends at x 130 and 230, centre line 130 high.
    expect(beltPoint(TRACK, 0)).toEqual({ x: 130, y: 56 });
    const perimeter = beltPerimeter(TRACK);
    expect(perimeter).toBeCloseTo(200 + 2 * Math.PI * 74, 6);
    // A quarter-lap later the mat is on the right-hand curve, below the top.
    const quarter = beltPoint(TRACK, 0.25);
    expect(quarter.x).toBeGreaterThan(230);
    expect(quarter.y).toBeGreaterThan(56);
    // Halfway round it rides the bottom straight, right to left.
    const half = beltPoint(TRACK, (100 + Math.PI * 74 + 50) / perimeter);
    expect(half.x).toBeCloseTo(180, 6);
    expect(half.y).toBeCloseTo(204, 6);
  });

  it("wraps progress, forwards and backwards", () => {
    expect(beltPoint(TRACK, 1.2)).toEqual(beltPoint(TRACK, 0.2));
    const back = beltPoint(TRACK, -0.2);
    const ahead = beltPoint(TRACK, 0.8);
    expect(back.x).toBeCloseTo(ahead.x, 6);
    expect(back.y).toBeCloseTo(ahead.y, 6);
  });

  it("keeps every mat inside the belt's box", () => {
    for (let step = 0; step < 100; step += 1) {
      const { x, y } = beltPoint(TRACK, step / 100);
      expect(x - TRACK.mat / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(x + TRACK.mat / 2).toBeLessThanOrEqual(TRACK.width + 1e-6);
      expect(y - TRACK.mat / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(y + TRACK.mat / 2).toBeLessThanOrEqual(TRACK.height + 1e-6);
    }
  });
});

describe("the belt's pace", () => {
  // 1 Nov 2026 is GMT, so the London wall clock reads UTC here.
  const at = (hhmm: string) => new Date(`2026-11-01T${hhmm}:00Z`);

  it("runs easy in the afternoon and hottest near last orders", () => {
    expect(beltPace(at("15:00"))).toBeCloseTo(0.6, 6);
    expect(beltPace(at("20:00"))).toBeCloseTo(1, 6);
    expect(beltPace(at("23:30"))).toBeCloseTo(1.4, 6);
    expect(beltPace(at("01:00"))).toBeCloseTo(1.4, 6);
    expect(beltPace(at("05:00"))).toBeCloseTo(0.6, 6);
  });

  it("turns the pace into a lap", () => {
    expect(beltLapMs(at("20:00"))).toBeCloseTo(48_000, 6);
    expect(beltLapMs(at("23:30"))).toBeLessThan(beltLapMs(at("15:00")));
  });
});

const ROWS: TonightCheapPint[] = [
  { venueId: "venue-a", name: "J.J. Moon's", borough: "Wandsworth", priceGbp: 2.09, chain: "wetherspoon" },
  { venueId: "venue-b", name: "Nags Head, Peckham", borough: "Southwark", priceGbp: 2.9, chain: null },
];

let host: HTMLDivElement;
let root: Root | null = null;

function stubMotion(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

function render() {
  root = createRoot(host);
  act(() => root?.render(createElement(TonightPintBelt, { rows: ROWS })));
}

describe("the pint belt", () => {
  it("rides the real rows as mats that open the pub on the map", () => {
    stubMotion(false);
    render();
    const mats = [...host.querySelectorAll<HTMLAnchorElement>("a.pintBeltMat")];
    expect(mats.map((mat) => mat.getAttribute("href"))).toEqual([
      "/map?sel=venue-a",
      "/map?sel=venue-b",
    ]);
    // A chain is named on its mat, as on its row; a free house shows its borough.
    expect(mats[0]?.textContent).toContain("Wetherspoon");
    expect(mats[1]?.textContent).toContain("Southwark");
    expect(mats[0]?.textContent).toContain("2.09");
  });

  it("has a control that stops it, and it starts running", () => {
    stubMotion(false);
    render();
    const pause = host.querySelector<HTMLButtonElement>('button[aria-label="Stop the belt"]');
    expect(pause?.getAttribute("aria-pressed")).toBe("false");
  });

  it("starts stopped for a reader who asked for less motion", () => {
    stubMotion(true);
    render();
    const pause = host.querySelector<HTMLButtonElement>('button[aria-label="Stop the belt"]');
    expect(pause?.getAttribute("aria-pressed")).toBe("true");
  });

  it("is drawn from 641px only, where the list steps back for it", () => {
    const css = readFileSync(join(process.cwd(), "app/tonight/tonightPintBelt.css"), "utf8");
    expect(css).toMatch(/\.pintBelt \{\s*display: none;/);
    expect(css).toMatch(/@media \(min-width: 641px\) \{[\s\S]*\.tonightCheapPintsBeltList \{\s*display: none;/);
  });
});
