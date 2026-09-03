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

const renderedLanding = renderToStaticMarkup(createElement(LandingPage));
const planIntake = readFileSync(PLAN_INTAKE, "utf8");

// Plan stays reachable from the front door without competing with its one
// primary action (issue #1354): a nav item and a footer directory link, never
// a second filled button.

describe("Lane H plan discoverability", () => {
  it("keeps the Pub Pal as the landing's second door beside the price receipt primary", () => {
    const hero = renderedLanding.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).toMatch(/data-primary-action=""><a[^>]*href="\/near\?locate=1"/);
    expect(hero).toMatch(/class="screenSecondary"><a[^>]*href="\/pal"[^>]*>Meet your Pub Pal<\/a>/);
  });

  it("exposes Plan in the landing primary nav", () => {
    const nav = renderedLanding.match(/<nav class="lpPrimaryNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toMatch(/href="\/plan"[^>]*>Plan<\/a>/);
  });

  it("keeps Plan in the footer directory and out of the hero", () => {
    const footer = renderedLanding.match(/<nav class="lpFooterNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(footer).toMatch(/href="\/plan"[^>]*>Plan a night<\/a>/);
    const hero = renderedLanding.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(hero).not.toMatch(/href="\/plan"/);
  });

  it("offers Pub Pal as an alternate entry on the plan intake surface", () => {
    expect(planIntake).toContain('href="/pal/chat"');
    expect(planIntake).toContain("Not sure?");
    expect(planIntake).toContain("Ask your Pub Pal…");
    expect(planIntake).toContain("planIntake__palEntry");
  });
});
