import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// SEO audit #2126: the landing printed "The average listed pint across 950
// London pubs is £5.54" and /about printed "The average is £5.72". Both are
// right, over different cohorts: the landing means each pub's cheapest pint
// (lib/pintSavings.ts), /about means every logged reading (lib/aboutStats.ts).
// A reader comparing the two needs the sentence to say which, so /about names
// the reading count beside its mean.

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
vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => null,
}));

import AboutPage from "@/app/about/page";

function priceLine(html: string): string {
  const line = html.match(/<p class="aboutPriceLine">([\s\S]*?)<\/p>/)?.[1] ?? "";
  return line.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("/about names the cohort its average pint is taken over", () => {
  it("states the reading count beside the mean", async () => {
    const line = priceLine(renderToStaticMarkup(await AboutPage()));
    expect(line).toContain("The average of all 2,785 logged prices is £5.72.");
  });

  it("never prints a bare average a reader could set against the landing's", async () => {
    const line = priceLine(renderToStaticMarkup(await AboutPage()));
    expect(line).not.toMatch(/The average is/);
  });
});
