import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import LandingLondonCollage from "@/components/landing/LandingLondonCollage";
import {
  LONDON_COLLAGE_CREDIT,
  LONDON_COLLAGE_PHOTOS,
  londonCollageSrc,
  londonCollageSrcSet,
} from "@/lib/landingLondonCollage";

describe("the founder London collage on the landing", () => {
  const html = renderToStaticMarkup(createElement(LandingLondonCollage));

  it("renders the section copy and defers photograph markup until the client", () => {
    expect(html).toContain("Streets the map sits on.");
    expect(html).toContain("lpCollageMosaic--pending");
    expect(html).toContain(LONDON_COLLAGE_CREDIT);
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(html).not.toContain(`alt="${photo.alt}"`);
    }
  });

  it("does not preload collage bytes in the first HTML", () => {
    expect(html).not.toContain("fetchpriority=");
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain('loading="lazy"');
  });

  it("advertises each photograph's real encoded width as its widest candidate", () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(londonCollageSrcSet(photo, "avif")).toBe(
        `${londonCollageSrc(photo, 640, "avif")} 640w, ${londonCollageSrc(photo, 1280, "avif")} ${photo.width}w`,
      );
    }
  });
});
