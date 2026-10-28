import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadAboutStats, resetAboutStatsForTests } from "@/lib/aboutStats";
import { loadLandingHeroData, resetLandingHeroDataForTests } from "@/lib/landingPubCard.server";

const rows = Array.from({ length: 30 }, (_, index) => ({
  pub_name: `Recovery Arms ${index}`,
  address: `${index} Recovery Street`,
  latitude: 51.51,
  longitude: -0.12,
  primary_borough: "Camden",
  pint_name: "Guinness",
  price_gbp: index < 15 ? 4 : 6,
  price_text: index < 15 ? "£4.00" : "£6.00",
  pub_url: `https://www.pint-prices.com/pub/recovery-${index}`,
  source_datasets: "Pint Prices",
  scraped_at_values: "2026-10-02T12:00:00Z",
}));

function resetPublicLoaders() {
  resetAboutStatsForTests();
  resetLandingHeroDataForTests();
}

beforeEach(resetPublicLoaders);
afterEach(() => {
  vi.restoreAllMocks();
  resetPublicLoaders();
});

describe("public statistics recover after a failed bundled price read", () => {
  it.each(["about-first", "landing-first", "concurrent"] as const)(
    "recovers both public loaders without a process restart after %s fails",
    async (order) => {
      const originalRead = fs.readFile.bind(fs);
      const failure = Object.assign(new Error("Temporary bundled price read failure"), { code: "EIO" });
      let priceReads = 0;
      vi.spyOn(fs, "readFile").mockImplementation((...args: Parameters<typeof fs.readFile>) => {
        if (!String(args[0]).endsWith("pint_prices_app_dataset.json")) return originalRead(...args);
        priceReads += 1;
        return (priceReads === 1 ? Promise.reject(failure) : Promise.resolve(JSON.stringify(rows))) as ReturnType<typeof fs.readFile>;
      });

      // The page may show its empty fallback or surface the read failure.
      // Neither response may prevent the next request from reading valid data.
      const firstRequests = order === "about-first" ? [loadAboutStats()]
        : order === "landing-first" ? [loadLandingHeroData()]
        : [loadAboutStats(), loadLandingHeroData()];
      const initial = await Promise.allSettled(firstRequests);
      for (const result of initial) {
        if (result.status === "rejected") expect(result.reason).toBe(failure);
      }
      expect(priceReads).toBe(1);

      // No cache reset or module reload occurs between the failed and good reads.
      const [about, landing] = await Promise.all([loadAboutStats(), loadLandingHeroData()]);
      expect(about.pubsTracked).toBe(30);
      expect(about.pintPricesObserved).toBe(30);
      expect(about.averagePint).toBe(5);
      expect(landing.averages).toEqual({ averageGbp: 5, cheapAverageGbp: 4, sampleSize: 30 });
      expect(priceReads).toBe(2);

      const [laterAbout, laterLanding] = await Promise.all([loadAboutStats(), loadLandingHeroData()]);
      expect(laterAbout.pubsTracked).toBe(30);
      expect(laterAbout.averagePint).toBe(5);
      expect(laterLanding.averages).toEqual({ averageGbp: 5, cheapAverageGbp: 4, sampleSize: 30 });
      expect(priceReads).toBe(2);
    },
  );
});
