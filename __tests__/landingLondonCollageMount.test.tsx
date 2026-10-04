// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LandingLondonCollage from "@/components/landing/LandingLondonCollage";
import { LONDON_COLLAGE_PHOTOS, londonCollageSrcSet } from "@/lib/landingLondonCollage";

let container: HTMLDivElement;
let root: Root;
let fire: ((isIntersecting: boolean) => void) | undefined;
let observerOptions: IntersectionObserverInit | undefined;
const disconnect = vi.fn();

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observerOptions = options;
    fire = (isIntersecting) =>
      callback(
        [{ isIntersecting } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }

  observe = vi.fn();
  disconnect = disconnect;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  fire = undefined;
  observerOptions = undefined;
  disconnect.mockClear();
  vi.unstubAllGlobals();
});

describe("the founder London collage once the reader scrolls near it", () => {
  it("holds every tile at its final size and fetches nothing until the section nears view", async () => {
    await act(async () => root.render(createElement(LandingLondonCollage)));

    expect(container.querySelectorAll(".lpCollageTile")).toHaveLength(LONDON_COLLAGE_PHOTOS.length);
    expect(container.querySelectorAll(".lpCollageTile__frame")).toHaveLength(LONDON_COLLAGE_PHOTOS.length);
    expect(container.querySelector("img")).toBeNull();
    expect(observerOptions?.rootMargin).toBe("80px 0px");

    await act(async () => fire?.(false));
    expect(container.querySelector("img")).toBeNull();
  });

  it("mounts every photograph lazily, with alt text, both formats and fixed dimensions", async () => {
    await act(async () => root.render(createElement(LandingLondonCollage)));
    await act(async () => fire?.(true));

    expect(disconnect).toHaveBeenCalled();
    const images = container.querySelectorAll<HTMLImageElement>("img.lpCollageTile__img");
    expect(images).toHaveLength(LONDON_COLLAGE_PHOTOS.length);

    for (const photo of LONDON_COLLAGE_PHOTOS) {
      const tile = container.querySelector(`[data-collage-id="${photo.id}"]`);
      const img = tile?.querySelector("img");
      expect(img?.getAttribute("alt")).toBe(photo.alt);
      expect(img?.getAttribute("width")).toBe(String(photo.width));
      expect(img?.getAttribute("height")).toBe(String(photo.height));
      expect(img?.getAttribute("loading")).toBe("lazy");
      expect(img?.hasAttribute("fetchpriority")).toBe(false);
      expect(tile?.querySelector('source[type="image/avif"]')?.getAttribute("srcset")).toBe(
        londonCollageSrcSet(photo, "avif"),
      );
      expect(tile?.querySelector('source[type="image/webp"]')?.getAttribute("srcset")).toBe(
        londonCollageSrcSet(photo, "webp"),
      );
      expect(tile?.textContent).toContain(photo.caption);
    }
  });
});
