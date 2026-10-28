import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HISTORIC_PUB_COUNT } from "@/components/landing/londonMapGeometry";
import { metadata as homeMetadata } from "@/app/page";
import { promises as fs } from "node:fs";
import { loadAboutStats, resetAboutStatsForTests } from "@/lib/aboutStats";
import { HOME_CARD_SUPPORT } from "@/lib/homeOgCard";
import { landingPriceReadLine, loadLandingHeroData, resetLandingHeroDataForTests } from "@/lib/landingPubCard.server";

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


describe("public loaders share one price snapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAboutStatsForTests();
    resetLandingHeroDataForTests();
  });

  it("keeps the same cohort when the price file changes between page reads", async () => {
    resetAboutStatsForTests();
    resetLandingHeroDataForTests();
    const rows = Array.from({ length: 30 }, (_, index) => ({
      pub_name: `Snapshot Arms ${index}`,
      address: `${index} Test Street`,
      latitude: 51.5,
      longitude: -0.1,
      primary_borough: "Camden",
      price_gbp: index < 15 ? 4 : 6,
      price_superseded: undefined as unknown,
      scraped_at_values: index === 0 ? undefined : "2026-10-02",
    }));
    rows.push(
      { ...rows[1], price_gbp: 9 },
      { ...rows[2], price_gbp: 0 },
      { ...rows[3], price_gbp: 2, price_superseded: { reason: "operator_change" } },
    );
    const originalRead = fs.readFile.bind(fs);
    let priceReads = 0;
    vi.spyOn(fs, "readFile").mockImplementation((...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith("pint_prices_app_dataset.json")) {
        priceReads += 1;
        return Promise.resolve(JSON.stringify(priceReads === 1 ? rows : rows.slice(0, 15))) as ReturnType<typeof fs.readFile>;
      }
      return originalRead(...args);
    });

    const stats = await loadAboutStats();
    const hero = await loadLandingHeroData();
    expect(stats.pubsTracked).toBe(30);
    expect(stats.pintPricesObserved).toBe(31);
    expect(stats.cheapestPint).toBe(4);
    expect(stats.dearestPint).toBe(9);
    expect(stats.averagePint).toBe(5);
    expect(hero.averages).toEqual({ averageGbp: 5, cheapAverageGbp: 4, sampleSize: 30 });
    expect(hero.priceReadLine).toContain("1 of its 30 pubs records no read day.");
  });
});
