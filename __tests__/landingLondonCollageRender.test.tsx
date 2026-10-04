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

  it("renders every tile and caption but defers the photographs to the client", () => {
    expect(html).toContain("Streets the map sits on.");
    expect(html).toContain(LONDON_COLLAGE_CREDIT);
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(html).toContain(`data-collage-id="${photo.id}"`);
      expect(html).toContain(photo.caption);
      expect(html).not.toContain(`alt="${photo.alt}"`);
    }
    expect(html).not.toContain("<img");
    expect(html).not.toContain('rel="preload"');
  });

  it("advertises each photograph's real encoded width as its widest candidate", () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(londonCollageSrcSet(photo, "avif")).toBe(
        `${londonCollageSrc(photo, 640, "avif")} 640w, ${londonCollageSrc(photo, 1280, "avif")} ${photo.width}w`,
      );
    }
  });
});
