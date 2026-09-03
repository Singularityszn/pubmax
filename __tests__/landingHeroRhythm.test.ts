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
// heading, the one primary, the second door, then the proof (the pub card and
// the counts). That order is the DOM order, so it is the phone order, and the
// desktop grid may only set the proof beside the copy, never reorder it.

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
      stats: {
        pubsTracked: 953,
        pintPricesObserved: 2788,
        boroughsCovered: 33,
        cheapestPint: 2.89,
        dearestPint: 8,
        averagePint: 5.5,
        historicPubsCited: 0,
        citiesCovered: 10,
      },
    }),
  );

  it("reads kicker, heading, primary, second door, pub card, counts, in that order", () => {
    const order = positions(html, [
      '<p class="kicker">PUBMAXX</p>',
      '<h1 class="screenTitle" id="hero-title">What a pint costs, pub by pub.</h1>',
      'data-primary-action=""',
      'class="screenSecondary"',
      'class="lpPubCard"',
      'class="lpLiveReadout"',
    ]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("carries no lede: the pub card is the support", () => {
    const hero = html.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).not.toContain("screenLede");
    expect(hero.match(/<p class="kicker">/g)).toHaveLength(1);
  });

  it("renders no card and no counts when the data cannot back them", () => {
    const bare = renderToStaticMarkup(createElement(LandingPage));
    expect(bare).not.toContain("lpPubCard");
    expect(bare).not.toContain("lpLiveReadout");
    expect(bare).toContain('<h1 class="screenTitle" id="hero-title">What a pint costs, pub by pub.</h1>');
  });
});
