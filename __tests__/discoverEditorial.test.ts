import { describe, expect, it } from "vitest";

import { curatedCrawlById, curatedCrawlMapHref } from "@/lib/curatedCrawls";
import { getRoutePack, routePackMapHref } from "@/lib/routePacks";

// Discover editorial CTAs must open map-first crawl/route URLs (polyline),
// not bare /map or filter-only arrivals. Mirrors the hrefs in app/discover/page.tsx.

describe("Discover editorial map deep-links", () => {
  it("heritage card opens Victorian Soho with crawl= + pubs=", () => {
    const crawl = curatedCrawlById("victorian-soho");
    expect(crawl).toBeDefined();
    const href = curatedCrawlMapHref(crawl!);
    expect(href).toMatch(/^\/map\?/);
    expect(href).toContain("crawl=victorian-soho");
    expect(href).toContain("mode=build");
    expect(href).toContain("pubs=");
  });

  it("coding pint card opens barbican-coding-pint on the map", () => {
    const crawl = curatedCrawlById("barbican-coding-pint");
    expect(crawl).toBeDefined();
    const href = curatedCrawlMapHref(crawl!);
    expect(href).toContain("crawl=barbican-coding-pint");
    expect(href).toContain("mode=build");
  });

  it("cheap crawl card opens cheap-chaos pack lead on the map", () => {
    const pack = getRoutePack("cheap-chaos");
    expect(pack).toBeDefined();
    const href = routePackMapHref(pack!);
    expect(href).toMatch(/^\/map\?/);
    expect(href).toContain("crawl=");
    expect(href).toContain("pubs=");
    expect(href).toContain("mode=build");
  });
});
