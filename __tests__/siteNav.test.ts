import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/tonight" }));

// SiteNav pulls in several context-bound children (auth, command palette,
// theme) and the app-router `usePathname` hook. This test isolates SiteNav's
// own markup — specifically the desktop Moment compose affordance (audit
// finding D2) — by stubbing those dependencies. `momentHref` stays REAL so the
// href shape under test is the same one the mobile FAB produces.
vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ prefetch: () => {} }),
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

async function renderSiteNav(active?: "today" | "tonight" | "crawls"): Promise<string> {
  const { default: SiteNav } = await import("@/components/nav/SiteNav");
  return renderToStaticMarkup(createElement(SiteNav, active ? { active } : undefined));
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

  it("exposes only live secondary destinations in More", async () => {
    const { SITE_NAV_MORE_LINKS } = await import("@/components/nav/SiteNavMore");
    // Plan and Social are primary destinations (Social by the captain's call,
    // 16 Oct 2026), so neither is repeated here.
    expect(SITE_NAV_MORE_LINKS.map((link) => link.href)).toEqual([
      "/wall",
      "/near",
      "/historic",
      "/pal",
    ]);
    expect(SITE_NAV_MORE_LINKS.map((link) => link.label)).toEqual([
      "Photos",
      "Near",
      "Historic",
      "Pal",
    ]);
  });

  it("explains what every More destination is for", async () => {
    const { SITE_NAV_MORE_LINKS } = await import("@/components/nav/SiteNavMore");
    expect(SITE_NAV_MORE_LINKS.map((link) => link.description)).toEqual([
      "Pints, pubs and London in photos",
      "Find priced pubs close to you",
      "Read the stories behind old pubs",
      "Ask for a pub that fits tonight",
    ]);
  });

  it("never lists Social in More, so the menu cannot repeat the tab", async () => {
    const { siteNavMoreItems } = await import("@/components/nav/SiteNavMore");
    expect(siteNavMoreItems().map((item) => item.href)).not.toContain("/social");
  });

  it("renders exactly one Social link and one Plan link in the primary row", async () => {
    const markup = await renderSiteNav();
    const row = markup.match(/<ul class="siteNavLinks">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(row.match(/href="\/social"/g)).toHaveLength(1);
    expect(row.match(/href="\/plan"/g)).toHaveLength(1);
  });

  it("keeps More markup free of em dashes", async () => {
    const markup = await renderSiteNav();
    expect(markup).not.toContain("—");
  });
});

// From 1024px each door draws its icon before its word (components/nav/navIcons.ts),
// so a door's markup is the tag, the icon's <svg>, then the word.
const DOOR_ICON = String.raw`(?:<svg(?:(?!<\/svg>)[\s\S])*<\/svg>)?`;
const currentDoor = (word: string) => new RegExp(String.raw`aria-current="page"[^>]*>` + DOOR_ICON + word + "<", "g");

describe("SiteNav current page state", () => {
  afterEach(() => {
    navigationState.pathname = "/tonight";
  });

  it("marks Tonight current when the host page is Day", async () => {
    navigationState.pathname = "/today";
    const markup = await renderSiteNav("today");
    const row = markup.match(/<ul class="siteNavLinks">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(row.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });

  it.each(["/social", "/feed"])("marks Social current on %s", async (pathname) => {
    navigationState.pathname = pathname;
    const markup = await renderSiteNav();
    const row = markup.match(/<ul class="siteNavLinks">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(row.match(currentDoor("Social")) ?? []).toHaveLength(1);
  });

  it.each(["/crawls", "/crawls/soho"])("marks Plan, never Social, current on %s", async (pathname) => {
    navigationState.pathname = pathname;
    const markup = await renderSiteNav("crawls");
    const row = markup.match(/<ul class="siteNavLinks">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(row.match(currentDoor("Plan")) ?? []).toHaveLength(1);
    expect(row).not.toMatch(currentDoor("Social"));
  });

  it("marks Tonight current when the host page is Tonight", async () => {
    navigationState.pathname = "/tonight";
    const markup = await renderSiteNav("tonight");
    const row = markup.match(/<ul class="siteNavLinks">[\s\S]*?<\/ul>/)?.[0] ?? "";
    expect(row.match(/aria-current="page"/g) ?? []).toHaveLength(1);
  });
});
