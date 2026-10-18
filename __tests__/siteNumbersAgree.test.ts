import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HISTORIC_PUB_COUNT } from "@/components/landing/londonMapGeometry";
import { metadata as homeMetadata } from "@/app/page";
import { loadAboutStats } from "@/lib/aboutStats";
import { HOME_CARD_SUPPORT } from "@/lib/homeOgCard";
import { loadLandingHeroData } from "@/lib/landingPubCard.server";

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
    expect(HOME_CARD_SUPPORT).toContain(`${stats.historicPubsCited} historic pubs`);
    expect(homeMetadata.openGraph?.description).toBe(HOME_CARD_SUPPORT);
    expect(homeMetadata.twitter?.description).toBe(HOME_CARD_SUPPORT);
  });
});
