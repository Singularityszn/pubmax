import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/scrapedPubs.server", () => ({
  readScrapedPubsForPage: vi.fn(),
}));

import { generateMetadata } from "@/app/pubs/page";
import { readScrapedPubsForPage } from "@/lib/scrapedPubs.server";

describe("/pubs metadata", () => {
  it("uses the same Chains heading in the page title as the on-page h1", async () => {
    vi.mocked(readScrapedPubsForPage).mockResolvedValue({
      pubs: [
        {
          id: "pub-1",
          name: "One",
          borough: "Camden",
          source: "youngs.co.uk",
          sourceLabel: "Young's",
          drinkAccent: "beer",
          drinkShelf: ["wine"],
          cheapestPrice: 4.5,
          zone: 2,
        },
        {
          id: "pub-2",
          name: "Two",
          borough: "Camden",
          source: "greene-king.co.uk",
          sourceLabel: "Greene King",
          drinkAccent: "beer",
          drinkShelf: ["cider"],
          cheapestPrice: 4.2,
          zone: 2,
        },
        {
          id: "pub-3",
          name: "Three",
          borough: "Westminster",
          source: "nicholsonspubs.co.uk",
          sourceLabel: "Nicholson's",
          drinkAccent: "beer",
          drinkShelf: ["spirits"],
          cheapestPrice: 5.1,
          zone: 1,
        },
      ],
      complete: true,
    });

    const meta = await generateMetadata();
    expect(meta.title).toBe("Chains (3 chain pubs)");
  });

  it("falls back to Chains when the scraped read is incomplete", async () => {
    vi.mocked(readScrapedPubsForPage).mockResolvedValue({
      pubs: [
        {
          id: "pub-1",
          name: "One",
          borough: "Camden",
          source: "youngs.co.uk",
          sourceLabel: "Young's",
          drinkAccent: "beer",
          drinkShelf: ["wine"],
          cheapestPrice: 4.5,
          zone: 2,
        },
      ],
      complete: false,
    });

    const meta = await generateMetadata();
    expect(meta.title).toBe("Chains");
  });
});
