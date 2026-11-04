import type { Route } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve() }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingHuntCard from "@/components/landing/LandingHuntCard";
import LandingPage from "@/components/landing/LandingPage";
import type { HuntPint } from "@/lib/cheapestHunt";
import type { LandingPubCardData } from "@/lib/landingPubCard";

// The hero's rhythm is the Screen primitive's order and nothing else: the
// heading (no brand kicker over it: the wordmark already says it), one line
// under it, the cheapest pint we can find in Britain (the hunt card that took
// the photograph's place on 1 Nov 2026), the one primary, the quiet row, then
// the one real pub and the three next-cheapest rows. That order is the DOM
// order, so it is the phone order, and the desktop grid may only seat the hunt
// card and the rows beside the copy, never reorder them.

const huntPint: HuntPint = {
  venueId: "venue-hunt",
  pubName: "The Scolt Head",
  cityId: "london",
  placeName: "London",
  priceGbp: 2,
  publisher: { label: "thescolthead.co.uk", url: "https://www.thescolthead.co.uk/drinks" },
  observedOn: "2026-09-21",
  standing: "listed",
  lane: "uk-bundle",
  mapHref: "/map?sel=venue-hunt" as Route,
};

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Blackfriar",
  area: "City of London",
  primaryBorough: "City of London",
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
          movement: null,
        },
      },
      rail: [
        { id: "venue-1", name: "The Crosse Keys", area: "City of London", primaryBorough: "City of London", priceGbp: 2.99, hasThen: false },
        { id: "venue-2", name: "The Liberty Bounds", area: "City of London", primaryBorough: "City of London", priceGbp: 2.99, hasThen: false },
        { id: "venue-3", name: "The Sir John Hawkshaw", area: "City of London", primaryBorough: "City of London", priceGbp: 3.49, hasThen: false },
      ],
      averages: { averageGbp: 5.54, cheapAverageGbp: 4.17, sampleSize: 950 },
      priceReadLine: "The average above comes from prices read between 4 July 2026 and 2 October 2026.",
      huntCard: createElement(LandingHuntCard, { pint: huntPint }),
    }),
  );

  it("reads heading, lede, hunt card, primary, quiet row, pub card, rail, in that order", () => {
    const order = positions(html, [
      '<h1 class="screenTitle" id="hero-title">What a pint costs, pub by pub.</h1>',
      '<p class="screenLede">',
      'class="lpHuntCard"',
      'data-primary-action=""',
      'class="screenSecondary"',
      // The card carries its photograph class too (lib/landingImagery.ts), so
      // the needle is the stable prefix rather than the whole attribute.
      'class="lpPubCard lpAnswerCard',
      'class="lpRail"',
    ]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the introduction short and puts measured savings below the answer", () => {
    const hero = html.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero.match(/class="screenLede"/g)).toHaveLength(1);
    // The figures are the ones handed in (lib/pintSavings.ts measures them from
    // the priced read), never typed into the hero.
    expect(hero).toContain('<p class="screenLede">Find a London pub, compare listed pint prices and plan your night.</p>');
    expect(hero).not.toContain('class="lpSavingSummary"');
    expect(html).toContain("The average of each pub&#x27;s cheapest listed pint across 950 pubs in our London pub list with a listed price is £5.54.");
    expect(html.indexOf('class="lpSavingSummary"')).toBeGreaterThan(html.indexOf('class="lpRail"'));
    // The stock photograph left with the hunt (captain decisions 2 and 3,
    // 1 Nov 2026): the hero's answer slot is the hunt card and no picture.
    expect(hero).not.toContain("Tower Bridge");
    expect(hero).not.toContain("/landing/hero-thames");
    expect(hero).not.toContain("lpLondonFigure");
    expect(hero).toContain('<div class="screenAnswer"><article class="lpHuntCard"');
    expect(hero).not.toContain('class="lpMapSnapshot"');
    // No brand kicker over the claim; the wordmark in the bar already says it.
    expect(hero).not.toContain('<p class="kicker">PUBMAXX</p>');
  });

  it("dates the average below the first screen, never inside the hero", () => {
    // At 320px a dated third lede line put the primary under the tab bar
    // (e2e/landing-find-my-pint.spec.ts), so the date lives in the band below.
    const hero = html.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).not.toContain("comes from prices read");
    expect(html).toContain(
      '<p class="lpPriceReads">The average above comes from prices read between 4 July 2026 and 2 October 2026.</p>',
    );
  });

  it("keeps the introduction when no savings can be measured", () => {
    const bare = renderToStaticMarkup(createElement(LandingPage, { card }));
    const hero = bare.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).toContain("Find a London pub, compare listed pint prices and plan your night.");
    expect(bare).not.toContain('class="lpSavingSummary"');
  });

  it("prints every rail row as its own Pint Drop door, with a price stamp and no borough the heading already names", () => {
    expect(html).toMatch(/<h2 class="lpRailTitle" id="lp-rail-title">Cheapest listed in City of London<\/h2>/);
    expect(html.match(/class="lpRailRow"/g)).toHaveLength(3);
    expect(html).toContain('href="/map?sel=venue-1&amp;log=1&amp;price=2.99"');
    expect(html).not.toMatch(/lpRailMeta">City of London/);
  });

  it("renders no card, no rail and no hunt card when the data cannot back them", () => {
    const bare = renderToStaticMarkup(createElement(LandingPage));
    expect(bare).not.toContain("lpPubCard");
    expect(bare).not.toContain("lpRail");
    // No pint may win, so no claim and no stand-in picture: the answer slot
    // is simply absent, and the heading, the primary and the quiet row stand.
    expect(bare).not.toContain("lpHuntCard");
    expect(bare).not.toContain("screenAnswer");
    expect(bare).not.toContain("lpLondonFigure");
    expect(bare).toContain('<h1 class="screenTitle" id="hero-title">What a pint costs, pub by pub.</h1>');
    expect(bare).toContain("data-primary-action");
  });
});
