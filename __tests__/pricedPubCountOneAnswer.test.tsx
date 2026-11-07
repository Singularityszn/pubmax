import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Launch review, 30 Oct 2026, section 3.2: the landing and /about said "942
// priced London pubs" while /pint-index said "960 of 2,034 pubs", and /about
// said "No borough league yet" beside a borough list on /pint-index. One
// module now answers both questions (lib/pricedPubCount.ts) and both pages
// read it, in the same words, on a stated base.

vi.mock("server-only", () => ({}));

const fixtures = vi.hoisted(() => ({
  read: {
    count: { listPubs: 2_034, pricedPubs: 960 },
    coverage: { total: 2_034, pricedPubs: 960, counts: {
      beer: 960, coffee: 0, "alcohol-free": 0, wine: 0, cocktail: 0, "soft-drink": 0,
      whisky: 0, gin: 0, vodka: 0, rum: 0, shot: 0, other: 0,
    } },
    status: "partial" as const,
  },
  calls: 0,
  snapshot: {
    schemaVersion: 1 as const, snapshotId: "controlled-empty", status: "empty" as const,
    generatedAt: "2026-10-01T00:00:00Z", observationWindow: null,
    classification: { version: "test", method: "point_in_polygon" as const,
      sourceArtifact: "test-boundaries", licence: "Open Government Licence v3.0" },
    sources: [], observations: [], excluded: [],
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/aboutStats", () => ({
  loadAboutStats: async () => ({
    pubsTracked: 939,
    pintPricesObserved: 2_785,
    cheapestPint: 1.99,
    dearestPint: 13,
    averagePint: 5.54,
    boroughsCovered: 33,
    historicPubsCited: 342,
    citiesCovered: 12,
  }),
}));
vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => fixtures.snapshot,
}));
vi.mock("@/lib/pricedPubCount.server", () => ({
  loadPricedPubCount: async () => {
    fixtures.calls += 1;
    return fixtures.read;
  },
}));

vi.mock("@/lib/pintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshotOrThrow: async () => fixtures.snapshot,
  loadPintIndexArchive: async () => [],
}));
vi.mock("@/lib/venueDataset", () => ({ loadGroupedVenues: async () => [] }));
vi.mock("@/lib/zonePintIndex.server", () => ({ loadZonePintIndex: async () => null }));
vi.mock("@/lib/boroughCoverageStatus.server", () => ({ loadSeedBoroughCoverage: async () => [] }));
vi.mock("@/lib/ukDirectoryCoverage.server", () => ({ loadUkDirectoryCoverage: async () => null }));

import AboutPage from "@/app/about/page";
import PintIndexPage from "@/app/pint-index/page";
import { listedDrinkCoverage } from "@/lib/listedDrinkCoverage";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";
import { PINT_INDEX_NOT_READY_LINE, pintIndexLeagueReady } from "@/lib/pintIndex";
import { averageBasePhrase, listedPriceCohort, pricedPubCountFromCoverage, pricedPubsSentence } from "@/lib/pricedPubCount";
import { strangerSavingLine } from "@/lib/pintSavings";

beforeEach(() => {
  fixtures.calls = 0;
  fixtures.read.count = { listPubs: 2_034, pricedPubs: 960 };
  fixtures.read.coverage = { ...fixtures.read.coverage, total: 2_034, pricedPubs: 960,
    counts: { ...fixtures.read.coverage.counts, beer: 960 } };
});

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");
}

describe("one priced-pub count", () => {
  it.each([
    { listPubs: 2_034, pricedPubs: 960, sentence: "960 of the 2,034 pubs in our London pub list have a pint price on record." },
    { listPubs: 10, pricedPubs: 3, sentence: "3 of the 10 pubs in our London pub list have a pint price on record." },
  ])("prints the specified count on both pages for $pricedPubs priced pubs", async ({ listPubs, pricedPubs, sentence }) => {
    fixtures.read.count = { listPubs, pricedPubs };
    fixtures.read.coverage = { ...fixtures.read.coverage, total: listPubs, pricedPubs,
      counts: { ...fixtures.read.coverage.counts, beer: pricedPubs } };
    expect(pricedPubsSentence(fixtures.read.count)).toBe(sentence);
    for (const page of [AboutPage, PintIndexPage]) {
      const callsBefore = fixtures.calls;
      const output = text(renderToStaticMarkup(await page()));
      expect(fixtures.calls).toBe(callsBefore + 1);
      expect(output).toContain(sentence);
    }
  });

  it("names the base of every average in the same words on the landing and /about", async () => {
    const landing = strangerSavingLine({ averageGbp: 5.54, cheapAverageGbp: 4.3, sampleSize: 939 });
    expect(landing).toContain(`across ${averageBasePhrase(939)} is £5.54`);
    const about = text(renderToStaticMarkup(await AboutPage()));
    expect(about).toContain(`The average listed pint across ${averageBasePhrase(939)} is`);
  });

  it("shows the unavailable league on both pages for a controlled empty snapshot", async () => {
    expect(pintIndexLeagueReady(fixtures.snapshot)).toBe(false);
    for (const page of [AboutPage, PintIndexPage]) {
      const output = text(renderToStaticMarkup(await page()));
      expect(output).toContain(PINT_INDEX_NOT_READY_LINE);
      expect(output).not.toContain("No borough league yet");
      expect(output).not.toContain("The Pint Index currently ranks");
    }
    expect(pintIndexLeagueReady(null)).toBe(false);
  });

  it("averages over pubs with their own listed pint, never a venue that is not a pub", () => {
    const cohort = listedPriceCohort([
      { kind: "pub", cheapestPrice: 5 },
      { kind: undefined, cheapestPrice: 4.5 },
      { kind: "bar", cheapestPrice: 6 },
      { kind: "pub", cheapestPrice: null },
    ] as never[]);
    expect(cohort).toHaveLength(2);
  });

  it("excludes bottle-only pubs while counting an independent pint", () => {
    const rows = [
      { kind: "pub", cheapestPrice: 5, cheapestPint: "Lager" },
      { kind: "pub", cheapestPrice: 6 },
      { kind: "pub", cheapestPrice: 2, prices: [{ price_gbp: 2, pint_name: "Half pint lager" }] },
      { kind: "pub", cheapestPrice: 9, cheapestPint: "Lager", prices: [
        { price_gbp: 9, pint_name: "BOTTLED BEER" },
        { price_gbp: 9, pint_name: "Lager", measure: "pint" },
      ] },
    ] as const;
    expect(listedPriceCohort(rows)).toEqual(rows.slice(0, 2));
    const pubs = groupVenuePrices([
      { pub_name: "Bottle only", pint_name: "BOTTLED BEER", price_gbp: 9 },
      { pub_name: "Mixed", pint_name: "BOTTLED BEER", price_gbp: 4 },
      { pub_name: "Mixed", pint_name: "Lager", measure: "pint", price_gbp: 6 },
      { pub_name: "Legacy", pint_name: "Lager", price_gbp: 5 },
    ].map((row) => ({ address: "1 Test Road", latitude: 51.5, longitude: -0.1, ...row })) as VenuePrice[]);
    expect(pricedPubCountFromCoverage(listedDrinkCoverage(pubs, []))).toEqual({ listPubs: 3, pricedPubs: 2 });
  });
});
