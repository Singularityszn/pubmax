import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// SiteNav pulls in several context-bound children (auth, command palette,
// theme) and the app-router `usePathname` hook. This test isolates SiteNav's
// own markup — specifically the desktop Moment compose affordance (audit
// finding D2) — by stubbing those dependencies. `momentHref` stays REAL so the
// href shape under test is the same one the mobile FAB produces.
vi.mock("next/navigation", () => ({
  usePathname: () => "/tonight",
}));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));

async function renderSiteNav(): Promise<string> {
  const { default: SiteNav } = await import("@/components/nav/SiteNav");
  return renderToStaticMarkup(createElement(SiteNav));
}

describe("SiteNav desktop Moment affordance (audit D2)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a Moment compose link into the action cluster", async () => {
    const markup = await renderSiteNav();
    expect(markup).toContain("siteNavMoment");
    expect(markup).toContain('aria-label="Share a Moment"');
  });

  it("points the Moment link at /moment carrying the current page as returnTo", async () => {
    const markup = await renderSiteNav();
    // Same href shape the mobile FAB emits via momentHref(): the compose route
    // with the current path url-encoded as returnTo so composing round-trips.
    expect(markup).toContain('href="/moment?returnTo=%2Ftonight"');
  });

  it("keeps the Moment affordance free of em dashes", async () => {
    const markup = await renderSiteNav();
    expect(markup).not.toContain("—");
  });
});
