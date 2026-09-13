// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
}));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/city/CityChooser", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/map",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";
import SiteNav from "@/components/nav/SiteNav";
import { MOMENT_NAV_ACTION, PRIMARY_NAV_ITEMS } from "@/components/nav/navigationModel";

// One product, one vocabulary. The landing bar is the first navigation a
// stranger reads, and it used to be hand-written JSX naming Map, Plan, Tonight,
// Moment, Social and You while every app page named Now, Map, Places, Out,
// Social and You. It is derived from PRIMARY_NAV_ITEMS now, and this file holds
// the two bars to the same labels, order and first-paint destinations.

function render(component: ComponentType): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(component));
  return host;
}

function links(host: HTMLElement, selector: string): HTMLAnchorElement[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>(selector));
}

const landingNav = () => links(render(LandingPage), ".lpPrimaryNav a");
const appNav = () => links(render(SiteNav), ".siteNavLinks a");

describe("one navigation vocabulary", () => {
  it("names the landing bar with the app's primary destinations, in order", () => {
    expect(landingNav().map((link) => link.textContent)).toEqual(
      PRIMARY_NAV_ITEMS.map((item) => item.label),
    );
  });

  it("gives the landing bar and the app bar the same labels", () => {
    expect(landingNav().map((link) => link.textContent)).toEqual(
      appNav().map((link) => link.textContent),
    );
  });

  it("sends each landing link where the app bar sends it on first paint", () => {
    expect(landingNav().map((link) => link.getAttribute("href"))).toEqual(
      appNav().map((link) => link.getAttribute("href")),
    );
  });

  it("leads the first-run bar with the loop, never Social or Moment", () => {
    const nav = landingNav();
    const labels = nav.map((link) => link.textContent ?? "");
    const hrefs = nav.map((link) => link.getAttribute("href") ?? "");
    expect(labels).toContain("Plan");
    expect(labels.some((label) => /social|moment/i.test(label))).toBe(false);
    expect(
      hrefs.some((href) => href.startsWith("/social") || href.startsWith(MOMENT_NAV_ACTION.href)),
    ).toBe(false);
  });
});
