import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

const PLAN_INTAKE = path.join(__dirname, "..", "components", "plan", "PlanIntake.tsx");

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

const renderedLanding = renderToStaticMarkup(createElement(LandingPage));
const planIntake = readFileSync(PLAN_INTAKE, "utf8");

// Plan stays reachable from the front door without competing with its one
// primary action (issue #1354): a nav item and a footer directory link, never
// a second filled button.

describe("Lane H plan discoverability", () => {
  it("keeps the near-me answer the landing's one primary and the Pal a door in the footer", () => {
    const hero = renderedLanding.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).toMatch(/data-primary-action=""><a[^>]*href="\/near\?locate=1"/);
    // The Pal moved off the hero's quiet row on 7 Sep 2026: the row caps at two
    // and the receipt door took the first place. Its footer door is the one
    // that must stay.
    const footerNav = renderedLanding.match(/<nav class="lpFooterNav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    expect(footerNav).toMatch(/href="\/pal"[^>]*>Pub Pal<\/a>/);
  });

  it("exposes Plan in the landing primary nav", () => {
    const nav = renderedLanding.match(/<nav class="lpPrimaryNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toMatch(/href="\/plan"[^>]*>Plan<\/a>/);
  });

  // Captain decision 2 (1 Nov 2026, docs/plans/LAUNCH_PLAN_2026-11-01.md):
  // under the hunt card the hero offers "Cheapest near you" and "Plan a crawl".
  // Plan is a QUIET door in the hero's secondary row, never its filled primary,
  // so it still does not compete with the one primary action.
  it("keeps Plan in the footer directory and a quiet door in the hero, never its primary", () => {
    const footer = renderedLanding.match(/<nav class="lpFooterNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(footer).toMatch(/href="\/plan"[^>]*>Plan a night<\/a>/);
    const hero = renderedLanding.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    const primary = hero.match(/data-primary-action="">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(primary).not.toMatch(/href="\/plan"/);
    const quietRow = hero.match(/<div class="screenSecondary">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(quietRow).toMatch(/href="\/plan"[^>]*>Plan a crawl<\/a>/);
    expect(hero.match(/href="\/plan"/g) ?? []).toHaveLength(1);
  });

  it("offers Pub Pal as an alternate entry on the plan intake surface", () => {
    expect(planIntake).toContain('href="/pal/chat"');
    expect(planIntake).toContain("Not sure?");
    expect(planIntake).toContain("Ask your Pub Pal…");
    expect(planIntake).toContain("planIntake__palEntry");
  });
});
