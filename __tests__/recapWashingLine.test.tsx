// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecapWashingLine, { washingLineDrop, washingLineHeight } from "@/components/recap/RecapWashingLine";

// The recap's shared photos hang on a string of festoon lights
// (components/recap/RecapWashingLine.tsx). Fixture images are Unsplash URLs
// that never load in jsdom; the shipped page only ever passes signed photos.

const PHOTOS = [
  { id: "a", url: "https://images.unsplash.com/photo-1514933651103-005eec06c04b", caption: "First round", venueName: "The Black Friar" },
  { id: "b", url: "https://images.unsplash.com/photo-1572116469696-31de0f17cc34", caption: null, venueName: null },
  { id: "c", url: "https://images.unsplash.com/photo-1436076863939-06870fe779c2", caption: "Last orders", venueName: "The Golden Heart" },
];

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(createElement(RecapWashingLine, { photos: PHOTOS })));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

const count = () => host.querySelector(".washingLineCount")?.textContent;
const button = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

describe("the washing line", () => {
  it("hangs every photo with its own caption and pub, and names the one in front", () => {
    const slides = [...host.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]')];
    expect(slides.map((slide) => slide.getAttribute("aria-label"))).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
    expect(slides.map((slide) => slide.dataset.current)).toEqual(["true", "false", "false"]);
    expect(slides[0]?.textContent).toContain("First round");
    expect(slides[0]?.textContent).toContain("The Black Friar");
    expect(slides[1]?.querySelector("img")?.getAttribute("alt")).toBe("A moment from the night");
    expect(count()).toBe("01 / 03");
  });

  it("moves with Previous and Next, and stops at either end without dropping focus", () => {
    expect(button("Previous photo")?.getAttribute("aria-disabled")).toBe("true");
    expect(button("Previous photo")?.disabled).toBe(false);
    act(() => button("Next photo")?.click());
    act(() => button("Next photo")?.click());
    expect(count()).toBe("03 / 03");
    expect(button("Next photo")?.getAttribute("aria-disabled")).toBe("true");
    act(() => button("Next photo")?.click());
    expect(count()).toBe("03 / 03");
  });

  it("answers the arrow keys, Home and End", () => {
    const viewport = host.querySelector<HTMLElement>(".washingLineViewport");
    const press = (key: string) =>
      act(() => {
        viewport?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    press("ArrowRight");
    expect(count()).toBe("02 / 03");
    press("End");
    expect(count()).toBe("03 / 03");
    press("Home");
    expect(count()).toBe("01 / 03");
  });

  it("grows to the tallest polaroid, so a long caption is read whole", () => {
    // A 500-character caption makes a tall card; the line must not clip it.
    const offsetHeight = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("washingLineCard") && this.textContent?.includes("Last orders") ? 520 : 230;
    });
    act(() => root?.unmount());
    root = createRoot(host);
    act(() => root?.render(createElement(RecapWashingLine, { photos: PHOTOS })));
    const viewport = host.querySelector<HTMLElement>(".washingLineViewport");
    expect(viewport?.style.height).toBe(`${washingLineHeight(520)}px`);
    expect(washingLineHeight(520)).toBeGreaterThan(520);
    // A short caption keeps the box the line held before it measured.
    expect(washingLineHeight(200)).toBe(284);
    offsetHeight.mockRestore();
  });

  it("hangs the string lowest in the middle and level at both ends", () => {
    expect(washingLineDrop(0, 600)).toBe(0);
    expect(washingLineDrop(600, 600)).toBe(0);
    expect(washingLineDrop(300, 600)).toBe(34);
    expect(washingLineDrop(150, 600)).toBeLessThan(34);
  });

  it("never moves by itself, never glows, and hangs straight at rest", () => {
    const source = readFileSync(join(process.cwd(), "components/recap/RecapWashingLine.tsx"), "utf8");
    expect(source).not.toMatch(/setInterval|autoplay=/i);
    // The comments say what the rules are; only the declarations are read.
    const css = readFileSync(join(process.cwd(), "components/recap/recapWashingLine.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/glow|drop-shadow|gradient/);
    expect(css).toMatch(/rotate\(var\(--washing-line-swing, 0deg\)\)/);
  });
});
