import type { Route } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import LandingHero from "@/components/landing/LandingHero";
import type { LandingArchiveIndex } from "@/lib/landingHero";
import type { LandingPubCardData } from "@/lib/landingPubCard";

// The one real pub above the fold prints facts with their sources beside
// them and nothing that reads as a claim it cannot back: no price band, no
// "live" wording, a grey pill that names the gap, and a "then" line a reader
// can check by following the link. The then line is read off the archive
// index the document ships, so the anchor and a near-you answer print it the
// same way.

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Blackfriar",
  area: "City of London",
  priceGbp: 6.5,
  pintName: "a pint of Pravha",
  drinkHref: "/drink/pravha" as Route,
  publisher: { label: "pint-prices.com", url: "https://www.pint-prices.com/pub/x" },
  observedOn: "2026-07-03",
  standing: "listed",
  then: {
    priceGbp: 3.6,
    observedOn: "2013-07-14",
    source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
  },
  movementLine: "Up £2.90 in 13 years.",
  mapHref: "/map?sel=venue-test",
};

const archive: LandingArchiveIndex = {
  "venue-test": {
    priceGbp: 3.6,
    observedOn: "2013-07-14",
    observedMonth: "July 2013",
    observedDay: "14 July 2013",
    years: 13,
    source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
  },
};

function render(overrides: Partial<LandingPubCardData> = {}, index: LandingArchiveIndex = archive): string {
  return renderToStaticMarkup(
    createElement(LandingHero, { card: { ...card, ...overrides }, archive: index, rail: [] }),
  );
}

describe("landing answer card copy", () => {
  const html = render();

  it("prints the listed price, who listed it and the collection day", () => {
    expect(html).toContain("£6.50");
    expect(html).toContain("a pint of Pravha");
    expect(html).toMatch(/Listed by <a href="https:\/\/www\.pint-prices\.com\/pub\/x"[^>]*>pint-prices\.com<\/a>, collected 3 July 2026\./);
    expect(html).toContain('href="/map?sel=venue-test"');
  });

  it("wears the standing lib/priceTier.ts decided, in words and in no tone", () => {
    // The chip carries the standing as a WORD. Colour on this card belongs to
    // the price band alone (captain's law 2026-09-05), so the chip's class
    // list is exactly `lpStanding` and the figure's badge wears the band.
    expect(html).toMatch(/<span class="lpStanding" data-standing="listed" title="[^"]+"><span class="lpStandingDot" aria-hidden="true"><\/span>Listed<\/span>/);
    expect(html).not.toMatch(/lpStanding-(green|amber|grey|modelled)/);
    expect(html).not.toContain("Confirmed");
    const none = render({ standing: "none" });
    expect(none).toMatch(/<span class="lpStanding" data-standing="none"[^>]*>[\s\S]*?No price yet<\/span>/);
  });

  it("paints the figure with its price band, red for a £6.50 London pint", () => {
    expect(html).toMatch(/class="priceBadge priceBadge--current priceBand-expensive[^"]*"[^>]*>£6\.50</);
    const cheap = render({ priceGbp: 4.2 });
    expect(cheap).toMatch(/priceBand-cheap[^"]*"[^>]*>£4\.20</);
  });

  it("prints the archive line with its month and its source day", () => {
    expect(html).toMatch(/<strong>£3\.60<\/strong> in July 2013\. Up £2\.90 in 13 years\./);
    expect(html).toMatch(/<a href="https:\/\/www\.beerintheevening\.com\/pubs\/x"[^>]*>beerintheevening\.com<\/a>, 14 July 2013/);
  });

  it("prints no then line when the archive index holds none for the pub", () => {
    const bare = render({}, {});
    expect(bare).not.toContain("lpPubThen");
  });

  it("claims nothing it cannot back", () => {
    const hero = html.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? html;
    expect(hero).not.toMatch(/data-band=/);
    // The visible words, not the markup: `aria-live` is a polite region, not a claim.
    const words = hero.replace(/<[^>]+>/g, " ");
    expect(words).not.toMatch(/\blive\b|verified/i);
    expect(words).not.toContain("!");
  });

  it("says no publisher is recorded when the row names none, and prints no day it does not hold", () => {
    const bare = render({ publisher: null, observedOn: null });
    expect(bare).toContain("No publisher recorded.");
    expect(bare).not.toMatch(/collected \d/);
  });

  it("dates the listing by the day its own row was read", () => {
    const unread = render({ observedOn: "2026-08-21" });
    expect(unread).toContain("collected 21 August 2026.");
  });

  it("asks Still £X? of the pub on the card, as the first QUIET door", () => {
    // The receipt door stopped being the primary on 7 Sep 2026: it ends in a
    // sign-in ask, and /near answers a stranger with no wall at all.
    expect(html).toMatch(/class="screenSecondary"><a[^>]*href="\/map\?sel=venue-test&amp;log=1&amp;price=6\.50"[^>]*>Still £6\.50\?<\/a>/);
    expect(html).toMatch(/data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Cheapest pints near me<\/a>/);
  });
});
