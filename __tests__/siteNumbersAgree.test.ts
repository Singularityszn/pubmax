import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HISTORIC_PUB_COUNT } from "@/components/landing/londonMapGeometry";
import { metadata as homeMetadata } from "@/app/page";
import { loadAboutStats } from "@/lib/aboutStats";
import { HOME_CARD_SUPPORT } from "@/lib/homeOgCard";
import { landingPriceReadLine, loadLandingHeroData } from "@/lib/landingPubCard.server";
import { loadPricedPubCount } from "@/lib/pricedPubCount.server";

// Site review, 18 Oct 2026: "The numbers disagree with each other. Homepage:
// average listed pint £5.54 across 950 London pubs. About page: average £5.72."
// Each was true over its own cohort, but a trust product cannot contradict
// itself. This test reads the SHIPPED dataset through both pages' own loaders
// and holds them to one figure, so a later change to either cohort fails here
// instead of on stage.

describe("the homepage and /about print one London average", () => {
  it("takes the same pubs and the same mean from the shipped dataset", async () => {
    const [stats, hero] = await Promise.all([loadAboutStats(), loadLandingHeroData()]);
    expect(hero.averages, "the shipped dataset backs a landing figure").toBeTruthy();
    expect(stats.pubsTracked).toBe(hero.averages!.sampleSize);
    expect(stats.averagePint).toBe(hero.averages!.averageGbp);
  });

  // Launch review, 30 Oct 2026: the average's base is a subset of the one
  // priced-pub count, never a second "priced pubs" figure beside it.
  it("takes its average over a subset of the pubs the one priced-pub count names", async () => {
    const [stats, priced] = await Promise.all([loadAboutStats(), loadPricedPubCount()]);
    expect(priced.count.listPubs).toBeGreaterThan(0);
    expect(priced.count.pricedPubs).toBeLessThanOrEqual(priced.count.listPubs);
    expect(stats.pubsTracked).toBeLessThanOrEqual(priced.count.pricedPubs);
  });
});

describe("the homepage and /about print one historic-pub count", () => {
  // Site review, 18 Oct 2026: "Historic pubs were quoted as 298 and are now
  // 342." The 298 was typed by hand from a drawing the landing no longer shows.
  it("prints every cited historic pub, the figure /about counts", async () => {
    const stats = await loadAboutStats();
    expect(stats.historicPubsCited).toBeGreaterThan(0);
    expect(HISTORIC_PUB_COUNT).toBe(stats.historicPubsCited);
    expect(homeMetadata.description).toBe(HOME_CARD_SUPPORT);
    expect(homeMetadata.openGraph?.description).toBe(HOME_CARD_SUPPORT);
    expect(homeMetadata.twitter?.description).toBe(HOME_CARD_SUPPORT);
  });
});

describe("the homepage dates the prices behind its average", () => {
  // Site review, 18 Oct 2026: "Freshness is quiet ... Surface 'last price
  // logged' stamps where people land." The line names the oldest read as well
  // as the newest, because it covers every price in the average.
  it("prints the read range of the shipped dataset", async () => {
    const hero = await loadLandingHeroData();
    expect(hero.priceReadLine).toMatch(
      /^The average above comes from prices read (between \d{1,2} \w+ \d{4} and \d{1,2} \w+ \d{4}|on \d{1,2} \w+ \d{4})\.( [\d,]+ of its [\d,]+ pubs records? no read day\.)?$/,
    );
  });

  it("counts the prices that record no read day rather than hiding them", () => {
    const dated = { name: "A", cheapestPrice: 5, prices: [{ price_gbp: 5, scraped_at_values: "2026-10-02T11:00:00Z" }] };
    const undated = { name: "B", cheapestPrice: 6, prices: [{ price_gbp: 6 }] };
    expect(landingPriceReadLine([dated] as never)).toBe("The average above comes from prices read on 2 October 2026.");
    expect(landingPriceReadLine([dated, undated] as never)).toBe(
      "The average above comes from prices read on 2 October 2026. 1 of its 2 pubs records no read day.",
    );
    expect(landingPriceReadLine([undated] as never)).toBeNull();
  });
});
