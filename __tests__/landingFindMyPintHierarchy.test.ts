import type { Route } from "next";
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
import { LANDING_QUIET_DOORS } from "@/lib/landingHero";

// The landing hierarchy is permanent and no flag decides it (captain
// 2026-09-03, issue #1354; 2026-09-04, issue #1357; rebuilt 2026-09-07): ONE
// primary action, and it is now `/near`, which answers a stranger in one tap
// and answers from a London patch when they say no to location. The price
// receipt door is the FIRST QUIET door, because it ends in a sign-in ask and a
// stranger has to be given something first. With a real pub behind the document
// that quiet door is "Still £X?" into that pub's Pint Drop composer; with no
// card it is the plain receipt door. Every other route off the page is a text
// link below the hero or a directory link in the footer.

import type { LandingPubCardData } from "@/lib/landingPubCard";
import { defined } from "@/__tests__/helpers/defined";

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Blackfriar",
  area: "City of London",
  priceGbp: 6.5,
  pintName: "a pint of Pravha",
  drinkHref: "/drink/pravha" as Route,
  publisher: { label: "Pint Prices", url: "https://www.pint-prices.com/pub/x" },
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

function render(withCard = true): string {
  return renderToStaticMarkup(createElement(LandingPage, withCard ? { card } : {}));
}

function hero(rendered: string): string {
  const match = rendered.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0];
  expect(match, "landing hero present").toBeTruthy();
  return match ?? "";
}

describe("landing hierarchy: the price receipt door", () => {
  it("uses the near-me answer as the only primary action, the receipt door as the first quiet one", () => {
    const h = hero(render());
    expect(h).toMatch(
      /data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Cheapest pints near me<\/a>/,
    );
    expect(h.match(/data-primary-action/g)).toHaveLength(1);
    // The pub's own Pint Drop door, quiet, still carrying that pub's figure.
    expect(h).toMatch(
      /class="screenSecondary"><a[^>]*href="\/map\?sel=venue-test&amp;log=1&amp;price=6\.50"[^>]*>Still £6\.50\?<\/a>/,
    );
    // No card behind the document: the same primary, and the plain receipt door.
    const bare = hero(render(false));
    expect(bare).toMatch(
      /data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Cheapest pints near me<\/a>/,
    );
    expect(bare.match(/data-primary-action/g)).toHaveLength(1);
    expect(bare).toMatch(/class="screenSecondary"><a[^>]*href="\/near"[^>]*>Log what you paid<\/a>/);
    expect(bare).not.toContain("lpPubCard");
    // The old landing button family is gone, so nothing else can wear coral.
    expect(h).not.toContain("lpButton");
  });

  it("asks for location only from the one primary, never the footer", () => {
    for (const rendered of [render(false), render()]) {
      const footerNav = rendered.match(/<nav class="lpFooterNav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
      expect(footerNav, "footer nav present").toBeTruthy();
      expect(footerNav).toMatch(/href="\/near"/);
      expect(footerNav).not.toMatch(/locate=1/);
      // Exactly one door on the whole page carries the geolocation ask, and it
      // is the deliberate tap in the head. /near itself answers from a London
      // patch when the reader says no, so this tap never ends at a wall.
      expect(rendered.match(/href="\/near\?locate=1"/g)).toHaveLength(1);
    }
  });

  it("counts the landing's own calls to action: one primary, one quiet row, one text link", () => {
    const rendered = render();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
    // ONE quiet row: the receipt door, then Tonight (#1488). Two is that row's
    // cap (components/ui/screen.tsx, `secondary`), so a third way onward fails
    // here rather than in a browser nobody opens.
    expect(rendered.match(/class="screenSecondary"/g)).toHaveLength(1);
    const secondary = rendered.match(/<div class="screenSecondary">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const quietDoors = [...secondary.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(quietDoors).toEqual([
      ["/map?sel=venue-test&amp;log=1&amp;price=6.50", "Still £6.50?"],
      ["/tonight", "Tonight"],
    ]);
    // The receipt door is dynamic, so the STATIC half of the row is the table
    // in lib/landingHero.ts, which is what e2e/mobile-button-system.spec.ts
    // counts the painted anchors against; the two cannot disagree about how
    // many doors the hero carries (#1503).
    expect(quietDoors.slice(1)).toEqual(LANDING_QUIET_DOORS.map((door) => [door.href, door.label]));
    const textLinks = [...rendered.matchAll(/<a[^>]*class="lpTextLink"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    expect(textLinks).toEqual(["Open the map"]);
  });

  it("gives Tonight a tap on the phone's home screen that the dead nav never had", () => {
    // The landing bar hides its link list under 960px and the six-tab dock
    // carried Now rather than Tonight, so before #1488 the only rendered
    // /tonight link on `/` sat in the footer, thousands of pixels down.
    const hero = render().match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).toMatch(/href="\/tonight"/);
    expect(hero).toMatch(/class="lpTonightDoor"/);
  });

  it("opens the Map directly for a stranger and keeps city choice explicit", () => {
    const rendered = render();
    const landingNav = rendered.match(/<nav class="lpPrimaryNav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(landingNav, "landing navigation present").toBeTruthy();
    expect(landingNav).toMatch(/href="\/map"[^>]*>Map<\/a>/);

    const openMapLinks = [
      ...rendered.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ].filter((match) => defined(match[2]).includes("Open the map"));
    expect(openMapLinks.length).toBeGreaterThan(0);
    expect(openMapLinks.every((match) => match[1] === "/map")).toBe(true);
    expect(rendered).toMatch(/href="\/places"[^>]*>Pick your city<\/a>/);
  });
});
