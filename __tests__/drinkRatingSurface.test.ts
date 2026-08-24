import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}

describe("drink rating surface fence", () => {
  it("keeps drink ratings on the venue menu tab", () => {
    const venueMenuTab = source("components/map/inspector/VenueMenuTab.tsx");
    const drinkMenu = source("components/drinks/DrinkMenu.tsx");
    const drinkRatingRow = source("components/ratings/DrinkRatingRow.tsx");
    const ratingsClient = source("components/ratings/ratingsClient.ts");
    const starRating = source("components/ratings/StarRating.tsx");

    expect(venueMenuTab).toContain("DrinkMenu");
    expect(drinkMenu).toContain("DrinkRatingRow");
    expect(drinkRatingRow).toContain("StarRating");
    expect(drinkRatingRow).toContain("ratingsClient");
    expect(ratingsClient).toContain("fetchRatingSummary");
    expect(ratingsClient).toContain("postRating");
    expect(starRating).toContain("export default function StarRating");
  });

  it("does not mount the retired venue star-rating surfaces", () => {
    const ledger = source("app/ledger/[id]/page.tsx");
    const barTab = source("app/bar-tab/[id]/page.tsx");
    const discover = source("app/discover/DiscoverPageClient.tsx");
    const ratingsRoute = source("app/api/ratings/route.ts");

    expect(ledger).not.toContain("VenueRatingPanel");
    expect(barTab).not.toContain("VenueRatingPanel");
    expect(discover).not.toContain("TopRatedPubs");
    expect(ratingsRoute).not.toMatch(/top=1|params\.get\("top"\)/);
  });

  it("does not ship the removed venue rating components", () => {
    expect(() => source("components/ratings/VenueRatingPanel.tsx")).toThrow();
    expect(() => source("components/ratings/TopRatedPubs.tsx")).toThrow();
    expect(() => source("components/ratings/topRatedPubs.css")).toThrow();
  });
});
