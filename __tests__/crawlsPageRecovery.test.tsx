import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/round/RoundStarter", () => ({ default: () => null }));
vi.mock("@/components/crawls/HostOnDate", () => ({ default: () => null }));
vi.mock("@/app/crawls/CrawlsYouCanJoin", () => ({ default: () => null }));
vi.mock("@/lib/cityCrawlDirectory.server", () => ({
  loadCityCrawlGroups: async () => [{
    cityId: "manchester",
    cityName: "Manchester",
    priceNote: null,
    crawls: [{
      id: "test-walk",
      name: "Manchester test walk",
      stops: 2,
      href: "/map/manchester?mode=build&pubs=venue-mcr-a%2Cvenue-mcr-b",
    }],
  }],
}));
vi.mock("@/lib/venueDataset", () => ({
  loadGroupedVenues: async () => curatedCrawls[0]!.venueIds.map((id) => ({
    id,
    latitude: 51.5101,
    longitude: -0.1342,
  })),
}));

import CrawlsPage from "@/app/crawls/page";
import { encodeCrawlStory } from "@/lib/crawlStory";
import { curatedCrawls } from "@/lib/curatedCrawls";

const sharedStory = encodeCrawlStory({
  title: "A shared walk",
  caption: "Two stops together.",
  vibeTags: [],
  stops: [
    { venueId: "venue-a", name: "First pub" },
    { venueId: "venue-b", name: "Second pub" },
  ],
});

describe("/crawls shared-link recovery", () => {
  it.each([
    { url: "/crawls", s: undefined },
    { url: "/crawls?s=", s: "" },
    { url: "/crawls?s=invalid", s: "invalid" },
    { url: "/crawls?s=e30", s: "e30" },
    { url: "/crawls?s=invalid&s=valid-story", s: ["invalid", sharedStory] },
  ])("$url renders the city directory and featured photograph", async ({ s }) => {
    const html = renderToStaticMarkup(await CrawlsPage({
      searchParams: s === undefined ? undefined : Promise.resolve({ s }),
    }));

    expect(html).toContain("London pub crawl routes");
    expect(html).toContain("Crawls in other cities");
    expect(html).toContain("Manchester test walk");
    expect(html).toContain('href="/map/manchester?mode=build&amp;pubs=venue-mcr-a%2Cvenue-mcr-b"');
    expect(html).toContain('data-photo-key="landing:piccadilly-circus"');
  });

  it.each([{ s: sharedStory }, { s: [sharedStory, "invalid"] }])(
    "renders a valid shared story without the directory",
    async ({ s }) => {
      const html = renderToStaticMarkup(await CrawlsPage({
        searchParams: Promise.resolve({ s }),
      }));

      expect(html).toContain("A shared walk");
      expect(html).toContain("First pub");
      expect(html).toContain("Second pub");
      expect(html).not.toContain("Crawls in other cities");
      expect(html).not.toContain("data-photo-key=");
    },
  );
});
