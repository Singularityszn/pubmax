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

import LandingPage from "@/components/landing/LandingPage";
import { LANDING_QUIET_DOORS } from "@/lib/landingHero";

// The landing has one primary action and one quiet row. General price entry
// starts with the pub picker, independently of the featured pub.

import type { LandingPubCardData } from "@/lib/landingPubCard";
import { defined } from "@/__tests__/helpers/defined";

const card: LandingPubCardData = {
  id: "venue-test",
  name: "The Blackfriar",
  area: "City of London",
  primaryBorough: "City of London",
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
    // A general contribution starts with a pub choice, without a price seed.
    expect(h).toMatch(
      /class="screenSecondary"><a[^>]*href="\/map\?log=1"[^>]*>Log what you paid<\/a>/,
    );
    // No card behind the document: the same primary, and the plain receipt door.
    const bare = hero(render(false));
    expect(bare).toMatch(
      /data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Cheapest pints near me<\/a>/,
    );
    expect(bare.match(/data-primary-action/g)).toHaveLength(1);
    expect(bare).toMatch(/class="screenSecondary"><a[^>]*href="\/map\?log=1"[^>]*>Log what you paid<\/a>/);
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
    // ONE quiet row: the receipt door, then Plan a crawl (captain decision 2,
    // 1 Nov 2026, in the place #1488 gave Tonight). Two is that row's cap
    // (components/ui/screen.tsx, `secondary`), so a third way onward fails
    // here rather than in a browser nobody opens.
    expect(rendered.match(/class="screenSecondary"/g)).toHaveLength(1);
    const secondary = rendered.match(/<div class="screenSecondary">([\s\S]*?)<\/div>/)?.[1] ?? "";
    const quietDoors = [...secondary.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
      (match) => [match[1], (match[2] ?? "").replace(/&#x27;/g, "'")],
    );
    expect(quietDoors).toEqual([
      ["/map?log=1", "Log what you paid"],
      ["/plan", "Plan a crawl"],
    ]);
    // The STATIC half of the row is the table
    // in lib/landingHero.ts, which is what e2e/mobile-button-system.spec.ts
    // counts the painted anchors against; the two cannot disagree about how
    // many doors the hero carries (#1503).
    expect(quietDoors.slice(1)).toEqual(LANDING_QUIET_DOORS.map((door) => [door.href, door.label]));
    const textLinks = [...rendered.matchAll(/<a[^>]*class="lpTextLink"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    expect(textLinks).toEqual(["Browse pubs across the UK", "Open the map"]);
  });

  it("puts Plan a crawl under the hunt, beside the near-you primary", () => {
    // Captain decision 2 (1 Nov 2026): under the cheapest pint we can find,
    // the front door offers the cheapest near you and a crawl. Tonight keeps
    // its tap in the five-tab dock (decision 13) and the footer.
    const rendered = render();
    const hero = rendered.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).toMatch(/<a[^>]*href="\/plan"[^>]*>Plan a crawl<\/a>/);
    expect(hero).toMatch(/<a[^>]*class="lpPlanDoor"[^>]*>Plan a crawl<\/a>/);
    expect(hero).not.toMatch(/href="\/tonight"/);
    const footerNav = rendered.match(/<nav class="lpFooterNav"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(footerNav).toMatch(/href="\/tonight"/);
  });

  it("opens the Map directly for a stranger and keeps city choice explicit", () => {
    const rendered = render();
    const landingNav = rendered.match(/<nav class="lpPrimaryNav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(landingNav, "landing navigation present").toBeTruthy();
    // The map's door is named Explore (captain, 1 Nov 2026) and still opens /map.
    expect(landingNav).toMatch(/href="\/map"[^>]*>Explore<\/a>/);

    const openMapLinks = [
      ...rendered.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ].filter((match) => defined(match[2]).includes("Open the map"));
    expect(openMapLinks.length).toBeGreaterThan(0);
    expect(openMapLinks.every((match) => match[1] === "/map")).toBe(true);
    expect(rendered).toMatch(/href="\/places"[^>]*>Pick your city<\/a>/);
  });
});
