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
// SiteNavMore keeps real markup so the overflow link contract is tested.

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

describe("SiteNav More overflow (Wave D2.2)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a More control for secondary destinations", async () => {
    const markup = await renderSiteNav();
    expect(markup).toContain("siteNavMore");
    expect(markup).toContain("siteNavMoreBtn");
    expect(markup).toContain(">More</span>");
  });

  it("exposes only live secondary destinations in More, Social last", async () => {
    const { SITE_NAV_MORE_LINKS } = await import("@/components/nav/SiteNavMore");
    // Plan is a primary destination now, so it is not repeated here; Social
    // left the primary row and lives here instead.
    expect(SITE_NAV_MORE_LINKS.map((link) => link.href)).toEqual([
      "/wall",
      "/near",
      "/historic",
      "/pal",
      "/social",
    ]);
    expect(SITE_NAV_MORE_LINKS.map((link) => link.label)).toEqual([
      "Drink Wall",
      "Near",
      "Historic",
      "Pal",
      "Social",
    ]);
  });

  it("explains what every More destination is for", async () => {
    const { SITE_NAV_MORE_LINKS } = await import("@/components/nav/SiteNavMore");
    expect(SITE_NAV_MORE_LINKS.map((link) => link.description)).toEqual([
      "Pints, pubs and London in photos",
      "Find priced pubs close to you",
      "Read the stories behind old pubs",
      "Ask for a pub that fits tonight",
      "Pub-night posts and crews",
    ]);
  });

  it("names Social in More the way the launch state names it", async () => {
    const { siteNavMoreItems } = await import("@/components/nav/SiteNavMore");
    const { socialSurfaceName } = await import("@/lib/socialLaunch");
    expect(siteNavMoreItems(socialSurfaceName(true)).at(-1)).toMatchObject({
      href: "/social",
      label: "Social",
    });
    expect(siteNavMoreItems(socialSurfaceName(false)).at(-1)).toMatchObject({
      href: "/social",
      label: "Social preview",
    });
  });

  it("renders no Social link and exactly one Plan link in the primary row", async () => {
    const markup = await renderSiteNav();
    const row = markup.match(/<ul class="siteNavLinks">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(row).not.toContain('href="/social"');
    expect(row.match(/href="\/plan"/g)).toHaveLength(1);
  });

  it("keeps More markup free of em dashes", async () => {
    const markup = await renderSiteNav();
    expect(markup).not.toContain("—");
  });
});

describe("SiteNav stacking", () => {
  it("is a positioned layer, so its Sign in popover is not covered by a page section", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("components/nav/siteNav.css", "utf8");
    const rule = css.match(/\.siteNavBar:not\(\.siteNavBarFloating\)\s*\{[^}]*\}/)?.[0] ?? "";
    // The bar is its own stacking context (backdrop-filter, named view
    // transition). Left at z-index:auto it painted under any positioned
    // section further down the page, such as the profile header, and clipped
    // the popover that hangs below it (signed-in QA F08, 6 Oct 2026).
    expect(rule).toMatch(/position:\s*relative/);
    expect(rule).toMatch(/z-index:\s*var\(--z-float/);
  });
});
