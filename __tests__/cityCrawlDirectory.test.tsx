// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCity } from "@/lib/cities";
import { getCityCapabilityProfile } from "@/lib/cityCapabilities";
import { curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { buildCityCrawlGroup, type CityCrawlGroup } from "@/lib/cityCrawlDirectory";
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
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector(".crawlOtherCitiesNote")?.textContent)
      .toBe(getCityCapabilityProfile(city.id).prices.explanation);
    const href = group!.crawls[0]!.href;
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

  // The captain's note-placement contract is the oracle. These cases reject
  // invented shared text and notes moved under the wrong city.
  it.each<{
    notes: [string | null, string | null, string | null];
    sharedNote: string | null;
    cityNotes: (string | null)[];
  }>([
    {
      notes: [
        "Price coverage varies by place and source.",
        "Price coverage varies by place and source.",
        "Price coverage varies by place and source.",
      ],
      sharedNote: "Price coverage varies by place and source.",
      cityNotes: [null, null, null],
    },
    {
      notes: ["Limited price coverage.", "Limited price coverage.", "No dated prices yet."],
      sharedNote: null,
      cityNotes: ["Limited price coverage.", "Limited price coverage.", "No dated prices yet."],
    },
    {
      notes: ["Limited price coverage.", null, null],
      sharedNote: null,
      cityNotes: ["Limited price coverage.", null, null],
    },
    {
      notes: [null, null, "No dated prices yet."],
      sharedNote: null,
      cityNotes: [null, null, "No dated prices yet."],
    },
    { notes: [null, null, null], sharedNote: null, cityNotes: [null, null, null] },
  ])("preserves shared and city notes for $notes", ({ notes, sharedNote, cityNotes }) => {
    const groups: CityCrawlGroup[] = ["manchester", "liverpool", "oxford"].map((id, index) => ({
      cityId: getCity(id).id,
      cityName: getCity(id).displayName,
      priceNote: notes[index]!,
      crawls: [{ id: crawl.id, name: crawl.name, stops: 2, href: curatedCrawlMapHref(crawl, id) }],
    }));
    const html = renderToStaticMarkup(<CityCrawlLinks groups={groups} />);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector(".crawlOtherCitiesHead .crawlOtherCitiesNote")?.textContent ?? null)
      .toBe(sharedNote);
    const sections = Array.from(document.querySelectorAll(".crawlCompactGroup"));
    expect(sections).toHaveLength(3);
    expect(sections.map((section) => section.querySelector(".crawlOtherCitiesNote")?.textContent ?? null))
      .toEqual(cityNotes);
    expect(document.querySelectorAll(".crawlOtherCitiesNote")).toHaveLength(
      sharedNote === null ? cityNotes.filter((note) => note !== null).length : 1,
    );
  });

  it("omits empty routes, disabled cities, and London from the additional directory", () => {
    expect(buildCityCrawlGroup(city, [{ ...crawl, venueIds: [] }], pack)).toBeNull();
    expect(buildCityCrawlGroup({ ...city, enabled: false }, [crawl], pack)).toBeNull();
    expect(buildCityCrawlGroup(getCity("london"), [crawl], pack)).toBeNull();
    expect(renderToStaticMarkup(<CityCrawlLinks groups={[]} />)).toBe("");
  });
});
