// @vitest-environment jsdom

// A landmark photo that fails to load never shows a broken-image glyph, and
// the credit leaves with the photo.
//
// The hero is a remote Wikimedia file. When the browser cannot draw it, the
// <img> collapses to a broken-image icon over the alt text while the CC credit
// bar stays underneath, crediting a photo nobody can see (captain's 390 shot,
// 2026-09-05). The component swaps the whole figure for the landmark's brand
// treatment on error, so the credit cannot outlive the bytes it is about.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import LandmarkHeroPhoto from "@/components/LandmarkHeroPhoto";
import heroStyles from "@/components/landmarkHeroPhoto.module.css";

const IMAGE = {
  url: "https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg?width=800",
  credit: "Wikimedia Commons",
  author: "Somebody",
  licenseShortName: "CC BY 2.5",
  licenseUrl: "https://creativecommons.org/licenses/by/2.5/",
  sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LandmarkHeroPhoto", () => {
  it("shows the photo with its credit while the image loads", () => {
    act(() => {
      root.render(
        createElement(LandmarkHeroPhoto, {
          image: IMAGE,
          name: "Covent Garden",
          className: "landmarkPhoto",
        }),
      );
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe(IMAGE.url);
    expect(img?.getAttribute("alt")).toBe("Covent Garden");
    expect(container.querySelector("figcaption")?.textContent).toContain("Somebody");
    expect(container.querySelector(`.${heroStyles.landmarkHeroFallback}`)).toBeNull();
  });

  it("swaps a failed photo for the brand treatment and drops the credit", () => {
    act(() => {
      root.render(
        createElement(LandmarkHeroPhoto, {
          image: IMAGE,
          name: "Covent Garden",
          className: "landmarkPhoto",
        }),
      );
    });
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("figcaption")).toBeNull();
    const fallback = container.querySelector(`.${heroStyles.landmarkHeroFallback}`);
    expect(fallback).not.toBeNull();
    // The caller's geometry class survives, so the box does not jump.
    expect(fallback?.classList.contains("landmarkPhoto")).toBe(true);
    expect(fallback?.getAttribute("aria-hidden")).toBe("true");
  });

  it("paints the brand treatment when a landmark has no photo at all", () => {
    act(() => {
      root.render(
        createElement(LandmarkHeroPhoto, {
          image: undefined,
          name: "Somewhere",
          className: "landmarkPhoto",
        }),
      );
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(`.${heroStyles.landmarkHeroFallback}`)).not.toBeNull();
  });
});
