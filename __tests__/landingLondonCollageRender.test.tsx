import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import LandingLondonCollage from "@/components/landing/LandingLondonCollage";
import {
  buildLondonCollageAreaPrices,
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

  it("paints every frame with its own blurred preview from the first HTML, never an empty box", () => {
    // The 16 Oct 2026 removal named grey frames as the fault: each frame now
    // carries its preview in the server markup, before any picture mounts.
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(html).toContain(`background-image:url(${photo.blurDataUrl})`);
    }
  });

  it("prints each area's price once, on the area's first tile, and nothing for an unpriced area", () => {
    const priced = renderToStaticMarkup(
      createElement(LandingLondonCollage, {
        areaPrices: {
          "canary-wharf": { cheapestPrice: 4.13, pubName: "The Ledger Building", pubCount: 2 },
          southwark: { cheapestPrice: 2.99, pubName: "The Pommelers Rest", pubCount: 30 },
        },
      }),
    );
    expect(priced.match(/Pints from/g)).toHaveLength(2);
    expect(priced).toContain('<data value="4.13">£4.13</data>');
    expect(priced).toContain('<data value="2.99">£2.99</data>');
    const firstCanaryTile = LONDON_COLLAGE_PHOTOS.find((photo) => photo.area === "canary-wharf");
    const tile = priced.split(`data-collage-id="${firstCanaryTile?.id}"`)[1]?.split("</li>")[0] ?? "";
    expect(tile).toContain("£4.13");
    expect(html).not.toContain("Pints from");
  });

  it("reads the cheapest priced pub inside half a mile of the area's first photo", () => {
    const southwark = LONDON_COLLAGE_PHOTOS.find((photo) => photo.area === "southwark");
    const [lat, lng] = southwark?.spot ?? [0, 0];
    const prices = buildLondonCollageAreaPrices([
      { name: "Near and dear", latitude: lat + 0.001, longitude: lng, cheapestPrice: 6.2 },
      { name: "Near and cheap", latitude: lat - 0.002, longitude: lng, cheapestPrice: 4.4 },
      { name: "Far and cheaper", latitude: lat + 0.05, longitude: lng, cheapestPrice: 2.1 },
      { name: "Near, no price", latitude: lat, longitude: lng, cheapestPrice: null },
    ]);
    expect(prices.southwark).toEqual({ cheapestPrice: 4.4, pubName: "Near and cheap", pubCount: 2 });
    expect(prices.westminster).toBeUndefined();
  });

  it("advertises each photograph's real encoded width as its widest candidate", () => {
    for (const photo of LONDON_COLLAGE_PHOTOS) {
      expect(londonCollageSrcSet(photo, "avif")).toBe(
        `${londonCollageSrc(photo, 640, "avif")} 640w, ${londonCollageSrc(photo, 1280, "avif")} ${photo.width}w`,
      );
    }
  });
});
