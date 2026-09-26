import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import LandingLondonCollage from "@/components/landing/LandingLondonCollage";
import {
  LONDON_COLLAGE_CREDIT,
  LONDON_COLLAGE_PHOTOS,
  londonCollageSrc,
} from "@/lib/landingLondonCollage";

describe("the founder London collage on the landing", () => {
  const html = renderToStaticMarkup(createElement(LandingLondonCollage));

  it("renders every photograph with alt text and both formats", () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(html).toContain(`alt="${photo.alt}"`);
      expect(html).toContain(londonCollageSrc(photo, 640, "avif"));
      expect(html).toContain(londonCollageSrc(photo, 640, "webp"));
      expect(html).toContain(photo.caption);
    }
  });

  it("names the founder credit and lazy-loads every tile", () => {
    expect(html).toContain(LONDON_COLLAGE_CREDIT);
    expect(html.match(/loading="lazy"/g)?.length ?? 0).toBe(LONDON_COLLAGE_PHOTOS.length);
    expect(html).not.toContain('fetchPriority="high"');
    expect(html).not.toContain('rel="preload"');
  });

  it("fixes dimensions on every image so the mosaic cannot shift layout", () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(html).toContain(`width="${photo.width}"`);
      expect(html).toContain(`height="${photo.height}"`);
    }
  });
});
