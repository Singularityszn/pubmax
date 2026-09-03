import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import LandingPubCard from "@/components/landing/LandingPubCard";
import type { LandingPubCardData } from "@/lib/landingPubCard";

// The one real pub above the fold prints facts with their sources beside
// them and nothing that reads as a claim it cannot back: no price band, no
// "live" wording, a grey pill that names the gap, and a "then" line a reader
// can check by following the link.

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Blackfriar",
  area: "City of London",
  priceGbp: 6.5,
  pintName: "a pint of Pravha",
  publisher: { label: "pint-prices.com", url: "https://www.pint-prices.com/pub/x" },
  collectedOn: "2026-07-03",
  standing: "listed",
  then: {
    priceGbp: 3.6,
    observedOn: "2013-07-14",
    source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
  },
  movementLine: "Up £2.90 in 13 years.",
  mapHref: "/map?sel=venue-test",
};

describe("landing pub card copy", () => {
  const html = renderToStaticMarkup(createElement(LandingPubCard, { card }));

  it("prints the listed price, who listed it and the collection day", () => {
    expect(html).toContain("£6.50");
    expect(html).toContain("a pint of Pravha");
    expect(html).toMatch(/Listed by <a href="https:\/\/www\.pint-prices\.com\/pub\/x"[^>]*>pint-prices\.com<\/a>, collected 3 July 2026\./);
    expect(html).toContain('href="/map?sel=venue-test"');
  });

  it("wears the standing lib/priceTier.ts decided, in words", () => {
    expect(html).toMatch(/<span class="lpStanding lpStanding-amber" data-standing="listed" title="[^"]+"><span class="lpStandingDot" aria-hidden="true"><\/span>Listed<\/span>/);
    expect(html).not.toContain("Confirmed");
    const none = renderToStaticMarkup(createElement(LandingPubCard, { card: { ...card, standing: "none" } }));
    expect(none).toMatch(/lpStanding-grey" data-standing="none"[^>]*>[\s\S]*?No price yet<\/span>/);
  });

  it("prints the archive line with its month and its source day", () => {
    expect(html).toMatch(/<strong>£3\.60<\/strong> in July 2013\. Up £2\.90 in 13 years\./);
    expect(html).toMatch(/<a href="https:\/\/www\.beerintheevening\.com\/pubs\/x"[^>]*>beerintheevening\.com<\/a>, 14 July 2013/);
  });

  it("claims nothing it cannot back", () => {
    expect(html).not.toMatch(/data-band=/);
    expect(html).not.toMatch(/\blive\b|cheapest|verified/i);
    expect(html).not.toContain("!");
  });

  it("says no publisher is recorded when the row names none", () => {
    const bare = renderToStaticMarkup(createElement(LandingPubCard, { card: { ...card, publisher: null } }));
    expect(bare).toContain("No publisher recorded, collected 3 July 2026.");
  });
});
