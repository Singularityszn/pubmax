// @vitest-environment jsdom
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
import PlanIntake from "@/components/plan/PlanIntake";
import { createPlanIntakeDraft } from "@/lib/planIntake";

const renderedLanding = renderToStaticMarkup(createElement(LandingPage));

// Plan stays reachable from the front door without competing with its one
// primary action (issue #1354): a nav item and a footer directory link, never
// a second filled button.

describe("Lane H plan discoverability", () => {
  it("retains the Pal footer door", () => {
    const footer = renderedLanding.match(/<nav class="lpFooterNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(footer).toMatch(/href="\/pal"[^>]*>Pub Pal<\/a>/);
  });

  it("exposes Plan in the landing primary nav", () => {
    const nav = renderedLanding.match(/<nav[^>]*class="siteNavBar"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(nav).toMatch(/aria-label="Plan"[^>]*href="\/plan"/);
  });

  it("keeps Plan in the footer", () => {
    const footer = renderedLanding.match(/<nav class="lpFooterNav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(footer).toMatch(/href="\/plan"[^>]*>Plan a night<\/a>/);
  });

  it("offers Pub Pal as an alternate entry on the plan intake surface", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(PlanIntake, {
      draft: createPlanIntakeDraft(),
      onChange: () => {},
    }));
    const link = [...host.querySelectorAll("a")].find((item) => /Pub Pal/.test(item.textContent ?? ""));
    expect(link?.getAttribute("href")).toBe("/pal/chat");
    expect(link?.closest("[hidden], [inert], [aria-hidden=\"true\"]")).toBeNull();
  });
});
