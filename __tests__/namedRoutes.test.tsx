import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));

import NamedRoutePage, { generateMetadata } from "@/app/routes/[slug]/page";
import { curatedCrawlById } from "@/lib/curatedCrawls";
import {
  buildNamedRoute,
  NAMED_ROUTES,
  namedRoutePathForCrawl,
  straightLineMinutesLabel,
} from "@/lib/namedRoutes";
import { groupVenuePrices, type Venue, type VenuePrice } from "@/lib/venues";

const dataset = groupVenuePrices(
  JSON.parse(readFileSync(join(process.cwd(), "public/data/pint_prices_app_dataset.json"), "utf8")) as VenuePrice[],
);

function venue(id: string, longitude: number, latitude: number): Venue {
  return {
    ...dataset[0]!,
    id,
    name: id,
    longitude,
    latitude,
    prices: [],
    cheapestPrice: null,
  };
}

describe("named route pages", () => {
  it("give four curated crawls a page in their own namespace", () => {
    expect(NAMED_ROUTES.map((route) => route.slug)).toEqual([
      "victorian-soho",
      "camden-market",
      "borough-market",
      "fleet-street",
    ]);
    for (const route of NAMED_ROUTES) {
      expect(curatedCrawlById(route.crawlId)).toBeDefined();
      expect(namedRoutePathForCrawl(route.crawlId)).toBe(`/routes/${route.slug}`);
    }
    expect(namedRoutePathForCrawl("youngs-beer-gardens")).toBeNull();
  });

  it("resolve every stop in the committed dataset, in the crawl's order", () => {
    for (const { slug, crawlId } of NAMED_ROUTES) {
      const route = buildNamedRoute(slug, dataset);
      expect(route?.missingVenueIds, slug).toEqual([]);
      expect(route?.stops.map((stop) => stop.venueId), slug).toEqual(curatedCrawlById(crawlId)?.venueIds);
      expect(route?.totalKm, slug).toBeGreaterThan(0);
    }
  });

  it("label a walk figure as a straight-line estimate and never print 0 min", () => {
    expect(straightLineMinutesLabel(0)).toBe("about 1 min (straight-line estimate)");
    expect(straightLineMinutesLabel(0.36)).toBe("about 5 min (straight-line estimate)");
  });

  it("withhold the route total when a stop is missing, and never measure across the gap", () => {
    const ids = curatedCrawlById("victorian-soho")!.venueIds;
    const venues = [venue(ids[0]!, -0.1, 51.5), venue(ids[2]!, -0.1, 51.51), venue(ids[3]!, -0.1, 51.52)];
    const route = buildNamedRoute("victorian-soho", venues)!;
    expect(route.totalKm).toBeNull();
    expect(route.missingVenueIds).toEqual([ids[1], ids[4]]);
    expect(route.stops.map((stop) => [stop.position, stop.legKm === null])).toEqual([
      [1, true],
      [3, true],
      [4, false],
    ]);
  });

  it("carry one canonical, the free and self-guided title, and no index for an unknown slug", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "victorian-soho" }) });
    expect(metadata.title).toBe("Victorian Soho: a free, self-guided London pub crawl");
    expect(metadata.alternates?.canonical).toBe("/routes/victorian-soho");
    expect(metadata.openGraph).toMatchObject({ url: "/routes/victorian-soho" });
    expect(String(metadata.description)).not.toMatch(/[–—]/);
    const unknown = await generateMetadata({ params: Promise.resolve({ slug: "soho" }) });
    expect(unknown.robots).toEqual({ index: false, follow: false });
  });

  it("print each stop's price with its source and read day, and the straight-line label", async () => {
    const html = renderToStaticMarkup(await NamedRoutePage({ params: Promise.resolve({ slug: "victorian-soho" }) }));
    expect(html).toContain("<h1");
    expect(html).toContain("Victorian Soho");
    expect(html).toMatch(/Source read \d{1,2} [A-Z][a-z]+ \d{4}|Source read date unknown/);
    expect(html).toContain("(straight-line estimate)");
    expect(html).not.toMatch(/\d+ min walk/);
    expect(html).toContain('href="/ledger/venue-1ufn31x"');
    expect(html).toContain("/map?mode=build&amp;pubs=");
  });
});
