import { createElement, type ReactNode } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/aboutStats", () => ({ loadAboutStats: vi.fn() }));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(element: ReactNode) {
      return new Response(renderToStaticMarkup(element));
    }
  },
}));

import { MARK_GEOMETRY } from "@/components/brand/PubmaxxMark";
import { metadata as homeMetadata } from "@/app/page";
import { GET as referralGet } from "@/app/r/[code]/route";
import LandingHero from "@/components/landing/LandingHero";
import { loadAboutStats, type AboutStats } from "@/lib/aboutStats";
import {
  HOME_CARD_EYEBROW,
  HOME_CARD_HERO_ACCENT,
  HOME_CARD_HERO_LEAD,
  HOME_CARD_HERO_TAIL,
  HOME_CARD_SUPPORT,
  HomeOgCard,
  homeCardCoverage,
  renderHomeOgCard,
} from "@/lib/homeOgCard";
import { MARK_POLYGONS, Wordmark } from "@/lib/ogBrand";

// The homepage share card is the most forwarded surface the product has: a
// referral link (/r/<code>) 307s to /#referral=…, whose head is the homepage's,
// so an invite preview IS this image. It went stale twice over in ways nothing
// caught, which is what this file fences:
//
//   1. It claimed 1,908 pubs tracked while the landing hero and /about said
//      953, because the card grouped the price dataset ITSELF and its copy of
//      the read never dropped the rows carrying no price.
//   2. It carried a coral chip holding an ink-deep X, the sanctioned plaque
//      tile inverted, long after the site header had moved to the PUBMA××ING
//      wordmark.
//
// So: one derived source for the numbers, and the header's own wordmark.

function stats(overrides: Partial<AboutStats> = {}): AboutStats {
  return {
    pubsTracked: 953,
    pintPricesObserved: 2788,
    cheapestPint: 1.99,
    dearestPint: 13,
    averagePint: 5.72,
    boroughsCovered: 33,
    historicPubsCited: 346,
    citiesCovered: 9,
    ...overrides,
  };
}

function renderCard(value: AboutStats): string {
  return renderToStaticMarkup(HomeOgCard({ stats: value }));
}

describe("home card figures are derived, never typed in", () => {
  it("takes every count from the stats it is handed", () => {
    expect(homeCardCoverage(stats())).toEqual([
      "953 pubs tracked",
      "2,788 prices on record",
      "London + 8 cities",
    ]);

    // A different dataset must move every figure on the card. If any of these
    // survived as a literal, this is where it would show.
    expect(
      homeCardCoverage(
        stats({ pubsTracked: 12, pintPricesObserved: 40, citiesCovered: 1 }),
      ),
    ).toEqual(["12 pubs tracked", "40 prices on record", "London"]);
  });

  it("drops a figure it does not have rather than printing a zero", () => {
    expect(
      homeCardCoverage(
        stats({ pubsTracked: 0, pintPricesObserved: 0, citiesCovered: 0 }),
      ),
    ).toEqual([]);

    const markup = renderCard(
      stats({ pubsTracked: 0, pintPricesObserved: 0, citiesCovered: 0 }),
    );
    expect(markup).not.toContain("0 pubs");
    expect(markup).not.toContain("0 prices");
    // The card still renders its brand and its promise with no counts at all.
    expect(markup).toContain(HOME_CARD_HERO_ACCENT);
  });

  it.each([
    [12, 40, 1, ["12 pubs tracked", "40 prices on record", "London"]],
    [24, 80, 3, ["24 pubs tracked", "80 prices on record", "London + 2 cities"]],
  ])("renders loaded counts for %s pubs", async (pubsTracked, pintPricesObserved, citiesCovered, expected) => {
    vi.mocked(loadAboutStats).mockResolvedValue(stats({ pubsTracked, pintPricesObserved, citiesCovered }));
    const response = await renderHomeOgCard();
    const markup = await response.text();
    for (const figure of expected) expect(markup).toContain(figure);
    expect(markup).not.toContain("953 pubs tracked");
    expect(markup).not.toContain("2,788 prices on record");
  });

  it("prints the figures it was handed", () => {
    const markup = renderCard(stats());
    expect(markup).toContain("953 pubs tracked");
    expect(markup).toContain("2,788 prices on record");
    expect(markup).toContain("London + 8 cities");
  });
});

describe("home card copy", () => {
  it("says what the landing page says", () => {
    const landing = renderToStaticMarkup(createElement(LandingHero, { card: null, archive: {}, rail: [] }));
    const hero = `${HOME_CARD_HERO_LEAD} ${HOME_CARD_HERO_TAIL} ${HOME_CARD_HERO_ACCENT}`;
    expect(hero).toBe("What a pint costs, pub by pub.");
    expect(landing).toMatch(/<h1[^>]*>What a pint costs, pub by pub\.<\/h1>/u);

    expect(HOME_CARD_SUPPORT).toBe("Find a London pub, compare listed pint prices and plan your night.");
    expect(landing).toContain(HOME_CARD_SUPPORT);
    expect(renderCard(stats())).toContain(HOME_CARD_SUPPORT);
  });

  it("keeps the retired night-OS lines off the card", () => {
    const markup = renderCard(stats());
    expect(markup).not.toContain("worth remembering");
    expect(markup).not.toContain("worth keeping");
    expect(markup).not.toContain("Last train home");
  });

  it("carries no em dash, no exclamation and no banned word", () => {
    // docs/VOICE.md house law, checked on the strings this module owns rather
    // than waiting for the tree-wide sweep to reach a card nobody reads in the
    // app.
    const lines = [
      HOME_CARD_EYEBROW,
      HOME_CARD_HERO_LEAD,
      HOME_CARD_HERO_TAIL,
      HOME_CARD_HERO_ACCENT,
      HOME_CARD_SUPPORT,
      ...homeCardCoverage(stats()),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/[—]|&mdash;|\s–\s/);
      expect(line).not.toContain("!");
      expect(line.toLowerCase()).not.toMatch(
        /\b(experience|discover|elevate|seamless|curated|unleash|empower|vibrant|effortless|robust|leverage|unlock|journey)\b/,
      );
    }
  });
});

describe("home card brand", () => {
  it("draws the site header's wordmark, not a boxed mark", () => {
    const markup = renderToStaticMarkup(Wordmark({}));
    // PUBMA + the doubled hero: the card reads PUBMAXX, the one product
    // name, and never PUBMAXXING.
    expect(markup).toContain("PUBMA");
    expect(markup).not.toContain("ING");
    // Two glyphs, the second tinted coral, and no ember: these are letterforms.
    expect(markup.match(/<svg/g)).toHaveLength(2);
    expect(markup).toContain("#ff5a5f");
    expect(markup).not.toContain("<circle");
    // The retired lockup: a coral rounded square holding an ink-deep X.
    expect(markup).not.toContain("borderRadius");
    expect(markup).not.toContain("border-radius");
    expect(markup).not.toContain("#060607");
  });

  it("cuts every card mark from the master geometry", () => {
    // lib/ogBrand re-declares the polygons because satori cannot import the
    // client component. Re-declared is fine; drifted is not.
    expect(MARK_POLYGONS.thick).toBe(MARK_GEOMETRY.thick);
    expect(MARK_POLYGONS.thinA).toBe(MARK_GEOMETRY.thinA);
    expect(MARK_POLYGONS.thinB).toBe(MARK_GEOMETRY.thinB);
  });

  it("puts the wordmark on the card", () => {
    const markup = renderCard(stats());
    expect(markup).toContain("PUBMA");
    expect(markup).toContain("pubmaxxing.com");
  });
});

describe("the invite path needs no card of its own", () => {
  it.each(["friday-pints", "code with & = # ?"])(
    "lands referral %s on the homepage, whose head names this card",
    async (code) => {
      const response = await referralGet(new Request("https://pubmaxxing.com/r/invite"), {
        params: Promise.resolve({ code }),
      });
      expect(response.status).toBe(307);
      const destination = new URL(response.headers.get("location")!);
      expect(destination.origin).toBe("https://pubmaxxing.com");
      expect(destination.pathname).toBe("/");
      expect(destination.search).toBe("");
      expect(new URLSearchParams(destination.hash.slice(1)).get("referral")).toBe(code);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(homeMetadata.openGraph?.images).toEqual([
        expect.objectContaining({ url: "/api/home-card", width: 1200, height: 630 }),
      ]);
      expect(homeMetadata.twitter?.images).toEqual(["/api/home-card"]);
    },
  );
});
