import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/scrapedPubs.server", () => ({
  readScrapedPubsForPage: vi.fn(),
}));

// The nav and the gallery are their own surfaces with their own coverage; what
// is under test is the page's own heading against its own title.
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/pubs/PubsGallery", () => ({ default: () => null }));

import PubsPage, { generateMetadata } from "@/app/pubs/page";
import type { ScrapedPub } from "@/lib/scrapedPubs";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";

/** The rendered heading and markup, read off the page's own output. */
async function rendered(): Promise<{ heading?: string; html: string }> {
  const html = renderToStaticMarkup(await PubsPage({}));
  return { heading: html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1], html };
}

function pub(over: Partial<ScrapedPub>): ScrapedPub {
  return {
    id: "pub-1",
    name: "One",
    borough: "Camden",
    source: "youngs.co.uk",
    sourceLabel: "Young's",
    cheapestPrice: 4.5,
    zone: 2,
    ...over,
  };
}

describe("/pubs head", () => {
  it("names the page for a reader and carries the count as the subtitle", async () => {
    vi.mocked(readScrapedPubsForPage).mockResolvedValue({
      pubs: [
        pub({}),
        pub({ id: "pub-2", name: "Two", source: "greene-king.co.uk", sourceLabel: "Greene King" }),
        pub({ id: "pub-3", name: "Three", source: "nicholsonspubs.co.uk", sourceLabel: "Nicholson's" }),
      ],
      complete: true,
    });

    const meta = await generateMetadata();
    expect(meta.title).toBe("Pub chains in London");
    const { heading, html } = await rendered();
    expect(heading).toBe(meta.title);
    expect(html).toContain(
      "3 Young&#x27;s, Nicholson&#x27;s and Greene King pubs whose menus we&#x27;ve checked.",
    );
    // The admin-style tally is gone from the heading.
    expect(heading).not.toMatch(/\(\d+ chain pubs\)/);
  });

  it("prints no count when the chain read is incomplete", async () => {
    vi.mocked(readScrapedPubsForPage).mockResolvedValue({ pubs: [pub({})], complete: false });

    const meta = await generateMetadata();
    expect(meta.title).toBe("Pub chains in London");
    const { heading, html } = await rendered();
    expect(heading).toBe(meta.title);
    expect(html).toContain(
      "Young&#x27;s, Nicholson&#x27;s and Greene King pubs whose menus we&#x27;ve checked.",
    );
    expect(html).not.toMatch(/\d+ Young/);
  });
});
