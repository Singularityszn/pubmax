import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  generateMetadata,
  generateStaticParams,
} from "@/app/area/[slug]/page";
import NightAreaLandingContent, {
  nightAreaLandingJsonLd,
} from "@/components/areas/NightAreaLandingContent";
import type { NightAreaLandingModel } from "@/lib/nightAreaLanding";

const model: NightAreaLandingModel = {
  slug: "clapham",
  name: "Clapham",
  description: "A compact south-London Night Area.",
  totalPricedVenues: 35,
  collectedLabel: "Prices last collected 3 July 2026.",
  rows: [
    {
      venueId: "venue-one",
      name: "The First Pub",
      borough: "Lambeth",
      priceGbp: 2.99,
      pintName: "House lager",
      publisher: {
        label: "Pint Prices",
        url: "https://www.pint-prices.com/pub/one",
      },
    },
  ],
};

function markup(): string {
  return renderToStaticMarkup(createElement(NightAreaLandingContent, { model }));
}

describe("governed Night Area landing page", () => {
  it("renders a price-first Night Area answer with exact publisher disclosure", () => {
    const html = markup();

    expect(html).toContain("Cheapest pints in Clapham");
    expect(html).toContain("35 publisher-backed pubs");
    expect(html).toContain("The First Pub");
    expect(html).toContain("Lambeth");
    expect(html).toContain("House lager");
    expect(html).toContain("£2.99");
    expect(html).toContain("Publisher: Pint Prices");
    expect(html).toContain('href="https://www.pint-prices.com/pub/one"');
  });

  it("shows one collection date and canonical map and Ledger links", () => {
    const html = markup();

    expect(html.match(/Prices last collected 3 July 2026\./g)).toHaveLength(1);
    expect(html).toContain('href="/map?q=Clapham"');
    expect(html).toContain('href="/ledger/venue-one"');
  });

  it("builds only factual BreadcrumbList and ItemList schema", () => {
    const graph = nightAreaLandingJsonLd(model);

    expect(graph.map((entry) => entry["@type"])).toEqual([
      "BreadcrumbList",
      "ItemList",
    ]);
    expect(graph[1]).toMatchObject({
      name: "Cheapest pints in Clapham",
      numberOfItems: 1,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
    });
  });

  it("pre-renders only current governed Night Areas", async () => {
    expect(await generateStaticParams()).toEqual([
      { slug: "clapham" },
      { slug: "victoria" },
      { slug: "piccadilly-soho" },
      { slug: "canary-wharf" },
    ]);
  });

  it("noindexes unknown or ungoverned Night Areas", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "camden" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
