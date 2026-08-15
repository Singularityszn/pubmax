import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  generateMetadata,
  generateStaticParams,
} from "@/app/drink/[category]/page";
import DrinkLandingContent, {
  drinkLandingJsonLd,
} from "@/components/drinks/DrinkLandingContent";
import type { DrinkLandingModel } from "@/lib/drinkLanding";

const model: DrinkLandingModel = {
  category: "beer",
  categoryLabel: "Beer",
  totalPricedVenues: 42,
  collectedLabel: "Prices last collected 3 July 2026.",
  rows: [
    {
      venueId: "venue-one",
      name: "The First Pub",
      borough: "Camden",
      priceGbp: 2.99,
      pintName: "House lager",
      publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/one" },
    },
    {
      venueId: "venue-two",
      name: "The Second Pub",
      borough: "Hackney",
      priceGbp: 3.5,
      pintName: "Best bitter",
      publisher: null,
    },
  ],
};

function markup(): string {
  return renderToStaticMarkup(createElement(DrinkLandingContent, { model }));
}

describe("governed beer landing page", () => {
  it("renders price-first rows with exact publisher disclosure", () => {
    const html = markup();

    expect(html).toContain("Cheapest beer in London");
    expect(html).toContain("42 priced pubs");
    expect(html).toContain("The First Pub");
    expect(html).toContain("Camden");
    expect(html).toContain("House lager");
    expect(html).toContain("£2.99");
    expect(html).toContain("Pint Prices");
    expect(html).toContain("Publisher not recorded");
  });

  it("links a named publisher to the exact row source", () => {
    expect(markup()).toContain('href="https://www.pint-prices.com/pub/one"');
  });

  it("shows the shared collection date once and links canonical destinations", () => {
    const html = markup();

    expect(html.match(/Prices last collected 3 July 2026\./g)).toHaveLength(1);
    expect(html).toContain('href="/map?drink=beer"');
    expect(html).toContain('href="/ledger/venue-one"');
    expect(html).toContain('href="/ledger/venue-two"');
  });

  it("builds only factual BreadcrumbList and ItemList schema", () => {
    const graph = drinkLandingJsonLd(model);

    expect(graph.map((entry) => entry["@type"])).toEqual([
      "BreadcrumbList",
      "ItemList",
    ]);
    expect(graph[1]).toMatchObject({
      numberOfItems: 2,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
    });
  });

  it("pre-renders only beer and noindexes unknown categories", async () => {
    expect(await generateStaticParams()).toEqual([{ category: "beer" }]);
    const metadata = await generateMetadata({
      params: Promise.resolve({ category: "wine" }),
    });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
