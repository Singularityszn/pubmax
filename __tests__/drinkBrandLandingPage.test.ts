import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {},
}));

vi.mock("@/lib/siteUrlConfig.mjs", () => ({
  PRODUCTION_SITE_ORIGIN: "https://example.test",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "test-nonce" }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => Promise.resolve(),
    }),
  };
});

import DrinkBrandLandingPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
  revalidate,
} from "@/app/drink/[slug]/page";
import DrinkBrandLandingImage from "@/app/drink/[slug]/opengraph-image";
import DrinkBrandLandingContent from "@/components/drinks/DrinkBrandLandingContent";
import {
  drinkBrandLandingJsonLd,
  loadDrinkBrandLanding,
} from "@/lib/drinkBrandLanding.server";
import type { DrinkBrandLanding } from "@/lib/drinkBrandLanding";

describe("governed drink brand landing page", () => {
  it("prebuilds only the current eligible beer brand slugs", async () => {
    await expect(generateStaticParams()).resolves.toEqual([
      { slug: "guinness" },
      { slug: "neck-oil" },
      { slug: "estrella" },
      { slug: "peroni" },
      { slug: "amstel" },
      { slug: "madri" },
      { slug: "camden-hells" },
      { slug: "birra-moretti" },
    ]);
  });

  it("keeps route rendering static and revalidates the bundled evidence daily", () => {
    expect(dynamicParams).toBe(false);
    expect(revalidate).toBe(86_400);
  });

  it("renders the immediate answer, both destinations, date, and twenty ranked rows", async () => {
    const page = await DrinkBrandLandingPage({
      params: Promise.resolve({ slug: "guinness" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Cheapest Guinness Pints in London");
    expect(html).toContain("From £3.09");
    expect(html).toContain('href="/map?drink=beer&amp;brand=guinness"');
    expect(html).toContain(
      'href="/map?drink=beer&amp;brand=guinness&amp;log=1"',
    );
    expect(html.match(/Collected 3 July 2026\./g)).toHaveLength(1);
    expect(html.match(/<ol\b/g)).toHaveLength(1);
    expect(html.match(/<li class="drinkBrandLanding__row"/g)).toHaveLength(20);
    expect(html).toContain("J.J. Moon's - JD Wetherspoon");
    expect(html).toContain("Pint Prices");
    expect(html).toContain("href=\"https://www.pint-prices.com/pub/");
    expect(html.match(/href="\/ledger\//g)).toHaveLength(20);
  });

  it("keeps missing publisher provenance explicit without inventing a source link", () => {
    const model: DrinkBrandLanding = {
      slug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 20,
      rows: [
        {
          rank: 1,
          venueId: "venue-1",
          venueName: "Test Venue",
          borough: "Camden",
          pintName: "Guinness",
          priceGbp: 3.09,
          publisher: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, { landing: model }),
    );

    expect(html).toContain("Publisher not recorded");
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('href="http');
  });

  it("binds metadata to the canonical route and leaves unknown brands noindex", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "guinness" }) }),
    ).resolves.toMatchObject({
      title: "Cheapest Guinness Pints in London",
      alternates: { canonical: "/drink/guinness" },
      openGraph: {
        type: "website",
        url: "/drink/guinness",
      },
    });

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "not-a-brand" }) }),
    ).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("returns 404 for an unknown brand instead of rendering an empty page", async () => {
    await expect(
      DrinkBrandLandingPage({
        params: Promise.resolve({ slug: "not-a-brand" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("publishes only BreadcrumbList and the rendered ItemList in JSON-LD", async () => {
    const landing = await loadDrinkBrandLanding("guinness");
    expect(landing).not.toBeNull();
    const graph = drinkBrandLandingJsonLd(landing!);

    expect(graph.map((entry) => entry["@type"])).toEqual([
      "BreadcrumbList",
      "ItemList",
    ]);
    expect(graph[0]?.itemListElement?.[0]?.item).toBe(
      "https://example.test/map",
    );
    expect(graph[1]?.itemListElement).toHaveLength(20);
    expect(graph[1]?.itemListElement?.[0]?.url).toContain(
      "https://example.test/ledger/",
    );
  });

  it("returns 404 for an unknown brand Open Graph request", async () => {
    await expect(
      DrinkBrandLandingImage({
        params: Promise.resolve({ slug: "not-a-brand" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});
