// The landing header's "Map" and the phone tab bar's "Map" are the SAME
// affordance at two widths, so they must name the same destination.
//
// They did not. The tab bar takes PRIMARY_NAV_ITEMS' canonical `/map` for every
// viewer, while the landing header sent a viewer with no stored city to
// `/choose-city` - so the same stranger, on the same visit, was told Map lived
// in two different places depending on which chrome they reached for.
//
// The line that resolves it is BROWSING versus ARRIVING, which the landing file
// already draws one comment away for `/near`: a nav or footer directory tap is
// browsing and goes to the map, while the three "Open the map" calls to action
// are the first-entry arrival and stay city-first. lib/cityPreference is the
// module that makes the browsing half honest - "when unset, Map links stay on
// /map" - so nothing here invents a city for anybody.
//
// e2e/smoke.spec.ts owns the arrival half against a real browser; this file
// owns the parity, because a rendered href is the whole claim.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PRIMARY_NAV_ITEMS } from "@/components/nav/navigationModel";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    loading: false,
    configured: true,
    user: null,
    handle: null,
    identityResolved: false,
    socialProviders: { google: false, apple: false },
  }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
  usePathname: () => "/",
}));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => "PUBMAXXING" }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/landing/ThamesHero", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
// A viewer who has never chosen a city: `readPreferredCity` answers null and the
// canonical map href is the London-default `/map` the real module returns for
// exactly that state.
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/map",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";

function landingHtml(): string {
  return renderToStaticMarkup(createElement(LandingPage));
}

function linkTags(html: string): RegExpMatchArray[] {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)];
}

function textOf(tag: RegExpMatchArray): string {
  return tag[1].replace(/<[^>]*>/g, "").trim();
}

function hrefOf(tag: RegExpMatchArray): string | null {
  return /href="([^"]*)"/.exec(tag[0])?.[1] ?? null;
}

function hrefOfLinkLabelled(html: string, label: string): string | null {
  const tag = linkTags(html).find((candidate) => textOf(candidate) === label);
  return tag ? hrefOf(tag) : null;
}

const TAB_BAR_MAP_HREF = PRIMARY_NAV_ITEMS.find((item) => item.key === "map")?.href;

describe("landing Map nav matches the phone tab bar", () => {
  it("sends a city-less viewer to the same Map the tab bar names", () => {
    expect(TAB_BAR_MAP_HREF).toBe("/map");

    const html = landingHtml();
    const nav = html.match(/<nav class="lpPrimaryNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav, "landing primary nav present").not.toBe("");

    expect(hrefOfLinkLabelled(nav, "Map")).toBe(TAB_BAR_MAP_HREF);
  });

  it("keeps the footer directory's map link on the same browsing destination", () => {
    // A footer directory tap is browsing, the same act the nav is, and the
    // footer says so itself about /near one line below this link.
    expect(hrefOfLinkLabelled(landingHtml(), "The map")).toBe(TAB_BAR_MAP_HREF);
  });

  it("still asks a city-less viewer to pick a city on the arrival CTA", () => {
    // The other half of the law: arriving is not browsing. A cold visitor picks
    // a city once rather than being silently placed in one.
    const openTheMap = linkTags(landingHtml()).filter((tag) =>
      textOf(tag).includes("Open the map"),
    );
    expect(openTheMap.length).toBeGreaterThan(0);
    for (const tag of openTheMap) expect(hrefOf(tag)).toBe("/choose-city");
  });

  it("keeps the city chooser reachable from the footer", () => {
    // Dropping the nav's chooser fallback may not make the chooser unreachable.
    expect(hrefOfLinkLabelled(landingHtml(), "Pick your city")).toBe("/choose-city");
  });
});
