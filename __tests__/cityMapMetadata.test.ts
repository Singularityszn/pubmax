import { describe, expect, it } from "vitest";

import { generateMetadata as generateCityMetadata } from "@/app/map/[city]/page";
import { generateMetadata as generateLondonMetadata } from "@/app/map/page";

describe("city map generateMetadata", () => {
  it("publishes city + Freshers band social preview for Oxford", async () => {
    const metadata = await generateCityMetadata({
      params: Promise.resolve({ city: "oxford" }),
      searchParams: Promise.resolve({ band: "freshers-first-night" }),
    });

    expect(metadata.title).toBe("Freshers first night — Oxford");
    expect(metadata.description).toMatch(/Freshers/i);
    expect(metadata.openGraph).toMatchObject({
      title: "Freshers first night — Oxford",
      type: "website",
      url: "/map/oxford?band=freshers-first-night",
      images: [
        {
          url: "/api/city-map-card?city=oxford&band=freshers-first-night",
          width: 1200,
          height: 630,
        },
      ],
    });
  });

  it("publishes Subcrawl preview for Glasgow", async () => {
    const metadata = await generateCityMetadata({
      params: Promise.resolve({ city: "glasgow" }),
      searchParams: Promise.resolve({ band: "subcrawl" }),
    });

    expect(metadata.title).toBe("Subcrawl — Clockwork Orange loop — Glasgow");
    expect(metadata.openGraph).toMatchObject({
      url: "/map/glasgow?band=subcrawl",
    });
  });

  it("falls back to city tagline without a band", async () => {
    const metadata = await generateCityMetadata({
      params: Promise.resolve({ city: "manchester" }),
    });

    expect(metadata.title).toBe("Manchester pub map");
    expect(metadata.description).toContain("Northern Quarter");
    expect(metadata.openGraph).toMatchObject({
      url: "/map/manchester",
      images: [{ url: "/api/city-map-card?city=manchester" }],
    });
  });

  it("wires London /map metadata lightly", async () => {
    const metadata = await generateLondonMetadata({
      searchParams: Promise.resolve({}),
    });

    expect(metadata.title).toBe("London pub map");
    expect(metadata.openGraph).toMatchObject({
      url: "/map",
      images: [{ url: "/api/city-map-card?city=london" }],
    });
  });
});
