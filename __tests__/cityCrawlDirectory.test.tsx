import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCity } from "@/lib/cities";
import type { CuratedCrawl } from "@/lib/curatedCrawls";
import { buildCityCrawlGroup } from "@/lib/cityCrawlDirectory";
import { CityCrawlLinks } from "@/app/crawls/CrawlsPageClient";

const city = getCity("manchester");
const crawl: CuratedCrawl = {
  id: "test-walk", name: "Test walk", blurb: "Two pubs.", crawlStyle: "heritage",
  venueIds: ["venue-mcr-a", "venue-mcr-b"],
};
const rows = [
  { id: "venue-mcr-a", lat: 53.48, lng: -2.24 },
  { id: "venue-mcr-b", lat: 53.49, lng: -2.23 },
];
const pack = { revision: "fixture-revision", rows };

describe("city crawl discovery", () => {
  it("renders the complete route in its city and states the price limitation", () => {
    const group = buildCityCrawlGroup(city, [crawl], pack);
    expect(group?.crawls).toHaveLength(1);
    const html = renderToStaticMarkup(<CityCrawlLinks groups={group ? [group] : []} />);
    expect(html).toContain("Crawls in other cities");
    expect(html).toContain("Manchester");
    expect(html).toContain("Test walk");
    expect(html).toContain("2 stops");
    expect(html).toContain("We haven&#x27;t yet collected pint prices for this city.");
    const href = group!.crawls[0].href;
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/map/manchester");
    expect(url.searchParams.get("pubs")).toBe("venue-mcr-a,venue-mcr-b");
    expect(url.searchParams.get("crawl")).toBe("test-walk");
    expect(url.searchParams.get("style")).toBe("heritage");
    expect(html).toContain(href.replaceAll("&", "&amp;"));
  });

  it.each([
    { revision: "fixture", rows: rows.slice(0, 1) },
    { revision: "fixture", rows: [rows[0], { ...rows[1], lat: null }] },
    { revision: "fixture", rows: [rows[0], { ...rows[1], lng: Number.NaN }] },
    { revision: "fixture", rows: [rows[0], { ...rows[1], lat: 91 }] },
    { revision: "fixture", rows: [rows[0], { ...rows[1], lat: 51.5 }] },
    { revision: "", rows },
    rows,
    null,
  ])("omits the whole route when the city pack cannot place every stop", (invalidPack) => {
    expect(buildCityCrawlGroup(city, [crawl], invalidPack)).toBeNull();
  });

  it("keeps complete routes without publishing partial routes from the same city", () => {
    const group = buildCityCrawlGroup(city, [
      crawl,
      { ...crawl, id: "unresolved-walk", venueIds: ["venue-mcr-a", "missing"] },
    ], pack);
    expect(group?.crawls.map((route) => route.id)).toEqual(["test-walk"]);
  });

  it("omits empty routes, disabled cities, and London from the additional directory", () => {
    expect(buildCityCrawlGroup(city, [{ ...crawl, venueIds: [] }], pack)).toBeNull();
    expect(buildCityCrawlGroup({ ...city, enabled: false }, [crawl], pack)).toBeNull();
    expect(buildCityCrawlGroup(getCity("london"), [crawl], pack)).toBeNull();
    expect(renderToStaticMarkup(<CityCrawlLinks groups={[]} />)).toBe("");
  });
});
