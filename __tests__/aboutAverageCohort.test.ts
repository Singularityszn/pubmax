import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// SEO audit #2126 and the site review of 18 Oct 2026: the landing printed
// "The average listed pint across 950 London pubs is £5.54" and /about printed
// £5.72, the mean of every reading. A trust product cannot contradict itself,
// so /about now takes the landing's cohort (each pub's cheapest pint, see
// lib/aboutStats.ts) and says so in the landing's own words.

const fixtures = vi.hoisted(() => ({
  stats: {
    pubsTracked: 950,
    pintPricesObserved: 2_785,
    cheapestPint: 1.99,
    dearestPint: 13,
    averagePint: 5.72,
    boroughsCovered: 33,
    historicPubsCited: 342,
    citiesCovered: 12,
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/lib/aboutStats", () => ({ loadAboutStats: async () => fixtures.stats }));
vi.mock("@/lib/pricedPubCount.server", () => ({
  loadPricedPubCount: async () => ({
    count: { listPubs: 2_034, pricedPubs: 960 },
    coverage: { total: 2_034, pricedPubs: 960, counts: {} },
    status: "ready",
  }),
}));
vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => null,
}));

import AboutPage from "@/app/about/page";

function priceLine(html: string): string {
  const line = html.match(/<p class="aboutPriceLine">([\s\S]*?)<\/p>/)?.[1] ?? "";
  return line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("/about names the cohort its average pint is taken over", () => {
  it("states the pub count beside the mean, in the landing's words", async () => {
    const line = priceLine(renderToStaticMarkup(await AboutPage()));
    expect(line).toContain(
      "The average listed pint across 950 pubs in our London pub list with a listed price is £5.72, the same figure the homepage gives, taken from each pub’s cheapest pint.",
    );
  });

  it("never prints a bare average a reader could set against the landing's", async () => {
    const line = priceLine(renderToStaticMarkup(await AboutPage()));
    expect(line).not.toMatch(/The average is/);
  });
});
