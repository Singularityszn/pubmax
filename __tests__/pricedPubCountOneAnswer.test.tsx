import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
    status: "ready" as const,
  },
  calls: 0,
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
  loadPublicPintIndexSnapshot: async () => ({
    ...JSON.parse(readFileSync("public/data/pint_index_snapshot.json", "utf8")),
  }),
}));
vi.mock("@/lib/pricedPubCount.server", () => ({
  loadPricedPubCount: async () => {
    fixtures.calls += 1;
    return fixtures.read;
  },
}));

import AboutPage from "@/app/about/page";
import ListedDrinkCoverage from "@/components/pintindex/ListedDrinkCoverage";
import { PINT_INDEX_NOT_READY_LINE, pintIndexLeagueReady, type PintIndexSnapshot } from "@/lib/pintIndex";
import { averageBasePhrase, listedPriceCohort, pricedPubsSentence } from "@/lib/pricedPubCount";
import { strangerSavingLine } from "@/lib/pintSavings";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");
}

describe("one priced-pub count", () => {
  it("is read by /about and /pint-index through the same loader", () => {
    for (const file of ["app/about/page.tsx", "app/pint-index/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain('import { loadPricedPubCount } from "@/lib/pricedPubCount.server";');
      expect(source, file).toMatch(/loadPricedPubCount\(/);
      expect(source, file).toContain("pintIndexLeagueReady(");
      expect(source, file).toContain("PINT_INDEX_NOT_READY_LINE");
      expect(source, file).not.toContain("No borough league yet");
    }
    // The /pint-index sentence is printed by the coverage block, from the same
    // sentence function /about prints.
    expect(readFileSync("components/pintindex/ListedDrinkCoverage.tsx", "utf8")).toContain("pricedPubsSentence(");
    expect(readFileSync("app/about/page.tsx", "utf8")).toContain("pricedPubsSentence(");
  });

  it("prints the same sentence on both pages for the same count", async () => {
    const sentence = pricedPubsSentence(fixtures.read.count);
    expect(sentence).toBe("960 of the 2,034 pubs in our London pub list have a pint price on record.");

    const about = text(renderToStaticMarkup(await AboutPage()));
    expect(fixtures.calls).toBeGreaterThan(0);
    expect(about).toContain(sentence);

    const index = text(renderToStaticMarkup(
      <ListedDrinkCoverage coverage={fixtures.read.coverage} status="partial" />,
    ));
    expect(index).toContain(sentence);
  });

  it("names the base of every average in the same words on the landing and /about", async () => {
    const landing = strangerSavingLine({ averageGbp: 5.54, cheapAverageGbp: 4.3, sampleSize: 939 });
    expect(landing).toContain(`across ${averageBasePhrase(939)} is £5.54`);
    const about = text(renderToStaticMarkup(await AboutPage()));
    expect(about).toContain(`The average listed pint across ${averageBasePhrase(939)} is`);
  });

  it("says the dated league is not ready on /about while the citable snapshot is empty", async () => {
    const snapshot = JSON.parse(readFileSync("public/data/pint_index_snapshot.json", "utf8")) as PintIndexSnapshot;
    if (snapshot.status === "empty") {
      expect(pintIndexLeagueReady(snapshot)).toBe(false);
      const about = text(renderToStaticMarkup(await AboutPage()));
      expect(about).toContain(PINT_INDEX_NOT_READY_LINE);
      expect(about).toContain("See the borough list");
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
});
