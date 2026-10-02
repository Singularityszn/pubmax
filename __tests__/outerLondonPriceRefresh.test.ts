import { describe, expect, it, vi } from "vitest";

import {
  fetchGatedOuterLondonPage,
  outerLondonUrlRefusal,
  priorPublishedSourceFor,
  selectDiscoveredOuterLondonMenu,
} from "../scripts/harvest_outer_london_prices.mjs";

describe("outer London price refresh source selection", () => {
  it("revisits the exact first-party page that previously published a price", () => {
    expect(
      priorPublishedSourceFor(
        { website: "https://tattoo-bar.co.uk/" },
        [
          {
            website: "https://tattoo-bar.co.uk/",
            sourceUrl: "https://tattoo-bar.co.uk/menu",
            result: "priced",
          },
        ],
      ),
    ).toBe("https://tattoo-bar.co.uk/menu");
  });

  it("uses the declared official website when no prior priced page exists", () => {
    expect(
      priorPublishedSourceFor(
        { website: "https://example-pub.co.uk/" },
        [{ website: "https://example-pub.co.uk/", result: "no-price-published" }],
      ),
    ).toBe("https://example-pub.co.uk/");
  });
});

describe("outer London fetch fence", () => {
  it("does not call the page provider or robots for a trailing-dot refused estate", async () => {
    for (const estate of ["millerandcarter.co.uk", "browns-restaurants.co.uk", "tobycarvery.co.uk"]) {
      const fetchRefreshPage = vi.fn();
      const robotsChecker = vi.fn();
      await expect(
        fetchGatedOuterLondonPage(
          `https://www.${estate}./menu`,
          `https://www.${estate}./`,
          { fetchRefreshPage, robotsChecker },
        ),
      ).rejects.toThrow(/source policy refused/);
      expect(fetchRefreshPage, estate).not.toHaveBeenCalled();
      expect(robotsChecker, estate).not.toHaveBeenCalled();
    }
  });

  it("asks robots before the page fetch and skips the page when robots disallow", async () => {
    const fetchRefreshPage = vi.fn();
    const robotsChecker = vi.fn(async () => ({
      allowed: false,
      evidence: "robots.txt disallows /menu",
    }));
    await expect(
      fetchGatedOuterLondonPage(
        "https://example-pub.co.uk/menu",
        "https://example-pub.co.uk/",
        { fetchRefreshPage, robotsChecker },
      ),
    ).rejects.toThrow(/disallows/);
    expect(robotsChecker).toHaveBeenCalledWith("https://example-pub.co.uk/menu");
    expect(fetchRefreshPage).not.toHaveBeenCalled();
  });

  it("keeps a discovered menu only when its host is the pub's own", () => {
    expect(outerLondonUrlRefusal(
      "https://aggregator.example/drinks",
      "https://example-pub.co.uk/",
    )).toMatch(/off-site/);
    expect(selectDiscoveredOuterLondonMenu(
      ["https://aggregator.example/drinks-menu", "https://example-pub.co.uk./drinks"],
      "https://www.example-pub.co.uk/",
    )).toBe("https://example-pub.co.uk./drinks");
  });

  it("fetches a public trailing-dot host once robots allows it", async () => {
    const fetchRefreshPage = vi.fn(async ({ url }: { url: string }) => ({
      markdown: "House lager £6.20",
      links: [],
      finalUrl: url,
    }));
    const robotsChecker = vi.fn(async () => ({ allowed: true }));
    await fetchGatedOuterLondonPage(
      "https://EXAMPLE-PUB.co.uk./menu",
      "https://www.example-pub.co.uk/",
      { fetchRefreshPage, robotsChecker },
    );
    expect(robotsChecker).toHaveBeenCalledWith("https://example-pub.co.uk/menu");
    expect(fetchRefreshPage).toHaveBeenCalledWith({
      job: "plain-page",
      url: "https://example-pub.co.uk/menu",
    });
  });
});
