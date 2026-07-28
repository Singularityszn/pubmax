import { describe, expect, it, vi } from "vitest";

// The map pages now read the server-owned trusted-handoff flags, which pulls the
// Next.js `server-only` guard module in at import time. It has no npm package to
// resolve under vitest, so stub it (the same pattern trustedHandoffFlags.test
// uses). generateMetadata itself never touches the flags.
vi.mock("server-only", () => ({}));

import { generateMetadata as generateCityMetadata } from "@/app/map/[city]/page";
import { generateMetadata as generateLondonMetadata } from "@/app/map/page";

describe("city map generateMetadata", () => {
  it("publishes city + Freshers band social preview for Oxford", async () => {
    const metadata = await generateCityMetadata({
      params: Promise.resolve({ city: "oxford" }),
      searchParams: Promise.resolve({ band: "freshers-first-night" }),
    });

    expect(metadata.title).toBe("Freshers first night · Oxford");
    expect(metadata.description).toMatch(/Freshers/i);
    expect(metadata.openGraph).toMatchObject({
      title: "Freshers first night · Oxford",
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

    expect(metadata.title).toBe("Subcrawl: Clockwork Orange loop · Glasgow");
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
    });
    // No explicit images override on the base city page: the file-convention
    // opengraph-image (app/map/[city]/opengraph-image.tsx) supplies the card;
    // /api/city-map-card only overrides when ?band= or ?crawl= is present.
    expect(metadata.openGraph).not.toHaveProperty("images");
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

  it("names an uncovered UK place without borrowing London metadata", async () => {
    const metadata = await generateLondonMetadata({
      searchParams: Promise.resolve({
        place: "Sheffield",
        lat: "53.3800941",
        lng: "-1.4789213",
      }),
    });

    expect(metadata.title).toBe("Sheffield pub map");
    expect(metadata.description).toBe(
      "Browse pubs mapped in Sheffield. No prices have been logged here yet.",
    );
    expect(metadata.openGraph).toMatchObject({
      title: "Sheffield pub map",
      url: "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213",
    });
    expect(metadata.openGraph).not.toHaveProperty("images");
  });

  it("publishes curated crawl social preview from crawl + pubs", async () => {
    const metadata = await generateLondonMetadata({
      searchParams: Promise.resolve({
        mode: "build",
        crawl: "victorian-soho",
        pubs: "venue-1,venue-2,venue-3,venue-4,venue-5",
      }),
    });

    expect(metadata.title).toBe("Victorian Soho · London");
    expect(metadata.description).toBe(
      "5-stop crawl: Victorian Soho in London. Open it on PUBMAXXING.",
    );
    expect(metadata.openGraph).toMatchObject({
      title: "Victorian Soho · London",
      url: "/map?crawl=victorian-soho",
      images: [
        {
          url: "/api/city-map-card?city=london&crawl=victorian-soho",
          width: 1200,
          height: 630,
        },
      ],
    });
  });

  it("publishes city crawl preview for Glasgow Subcrawl starter", async () => {
    const metadata = await generateCityMetadata({
      params: Promise.resolve({ city: "glasgow" }),
      searchParams: Promise.resolve({
        mode: "build",
        crawl: "subcrawl-starter",
        band: "subcrawl",
        pubs: "a,b,c,d,e,f",
      }),
    });

    expect(metadata.title).toBe("Subcrawl starter · Glasgow");
    expect(metadata.description).toMatch(/^6-stop crawl: Subcrawl starter/);
    expect(metadata.openGraph).toMatchObject({
      url: "/map/glasgow?band=subcrawl&crawl=subcrawl-starter",
      images: [
        {
          url: "/api/city-map-card?city=glasgow&band=subcrawl&crawl=subcrawl-starter",
        },
      ],
    });
  });
});
