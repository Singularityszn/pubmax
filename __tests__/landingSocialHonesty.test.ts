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
import { defined } from "@/__tests__/helpers/defined";

// The landing document is CDN-held, so its Social label is the first one a
// stranger reads. Social is not a front door, so the top bar carries none; the
// footer keeps one link, and it must agree with the rollback state: "Social"
// while the friends launch is on, "Social preview" when it is rolled back.

function renderLanding(socialFriendsLaunchEnabled: boolean): string {
  return renderToStaticMarkup(createElement(LandingPage, { socialFriendsLaunchEnabled }));
}

function socialLinks(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="\/social"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => defined(m[1]));
}

function landingNav(html: string): string {
  return html.match(/<nav class="lpPrimaryNav"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
}

describe("landing social honesty", () => {
  it("keeps Social out of the top bar in either launch state", () => {
    for (const enabled of [true, false]) {
      const nav = landingNav(renderLanding(enabled));
      expect(nav, "landing navigation present").not.toBe("");
      expect(nav).not.toContain('href="/social"');
      expect(nav).not.toContain("Social");
    }
  });

  it("names Social plainly in the footer while the friends launch is on", () => {
    const html = renderLanding(true);
    expect(socialLinks(html)).toEqual(["Social"]);
    expect(html).not.toContain("Social preview");
  });

  it("says Social preview in the footer when the launch is rolled back", () => {
    const html = renderLanding(false);
    expect(socialLinks(html)).toEqual(["Social preview"]);
  });

  it("offers no Social or Memories call to action on the landing", () => {
    const html = renderLanding(true);
    expect(html).not.toContain("Open Social");
    expect(html).not.toContain("night-memories");
  });
});
