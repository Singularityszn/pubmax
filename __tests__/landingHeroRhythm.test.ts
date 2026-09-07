import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";
import type { LandingPubCardData } from "@/lib/landingPubCard";

// The hero's rhythm is the Screen primitive's order and nothing else: kicker,
// heading, the answer (the one real pub), the one primary that acts on it,
// the second door, then the three next-cheapest rows. That order is the DOM
// order, so it is the phone order, and the desktop grid may only seat the
// answer and the rows beside the copy, never reorder them.

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

function positions(html: string, needles: string[]): number[] {
  return needles.map((needle) => {
    const at = html.indexOf(needle);
    expect(at, needle).toBeGreaterThan(-1);
    return at;
  });
}

describe("landing hero rhythm", () => {
  const html = renderToStaticMarkup(
    createElement(LandingPage, {
      card,
      archive: {
        "venue-test": {
          priceGbp: 3.6,
          observedOn: "2013-07-14",
          observedMonth: "July 2013",
          observedDay: "14 July 2013",
          years: 13,
          source: { label: "beerintheevening.com", url: "https://www.beerintheevening.com/pubs/x" },
        },
      },
      rail: [
        { id: "venue-1", name: "The Crosse Keys", area: "City of London", priceGbp: 2.99, hasThen: false },
        { id: "venue-2", name: "The Liberty Bounds", area: "City of London", priceGbp: 2.99, hasThen: false },
        { id: "venue-3", name: "The Sir John Hawkshaw", area: "City of London", priceGbp: 3.49, hasThen: false },
      ],
    }),
  );

  it("reads kicker, heading, pub card, primary, second door, rail, in that order", () => {
    const order = positions(html, [
      '<p class="kicker">PUBMAXX</p>',
      '<h1 class="screenTitle" id="hero-title">What a pint costs, pub by pub.</h1>',
      // The card carries its photograph class too (lib/landingImagery.ts), so
      // the needle is the stable prefix rather than the whole attribute.
      'class="lpPubCard lpAnswerCard',
      'data-primary-action=""',
      'class="screenSecondary"',
      'class="lpRail"',
    ]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("carries no lede: the pub card is the support", () => {
    const hero = html.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).not.toContain("screenLede");
    expect(hero.match(/<p class="kicker">/g)).toHaveLength(1);
  });

  it("prints every rail row as its own Pint Drop door, with a price stamp and no borough the heading already names", () => {
    expect(html).toMatch(/<h2 class="lpRailTitle" id="lp-rail-title">Cheapest listed in City of London<\/h2>/);
    expect(html.match(/class="lpRailRow"/g)).toHaveLength(3);
    expect(html).toContain('href="/map?sel=venue-1&amp;log=1&amp;price=2.99"');
    expect(html).not.toMatch(/lpRailMeta">City of London/);
  });

  it("renders no card and no rail when the data cannot back them", () => {
    const bare = renderToStaticMarkup(createElement(LandingPage));
    expect(bare).not.toContain("lpPubCard");
    expect(bare).not.toContain("lpRail");
    expect(bare).toContain('<h1 class="screenTitle" id="hero-title">What a pint costs, pub by pub.</h1>');
  });
});
