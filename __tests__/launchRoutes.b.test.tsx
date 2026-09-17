import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

// docs/design/LAUNCH_SCREENS.md: every launch route carries ONE primary
// action, painted by the Screen primitive (components/ui/screen.tsx) and
// marked `data-primary-action`. Group b of the wave-2 surface audit (issue
// #1354): /plan, /pal, /social, /places, /discover and /pubs.
//
// Each surface renders the way a first-time visitor meets it: signed out, with
// the live session answered, every network read settled, and the chrome
// another track owns stubbed to nothing. The mock block is the one
// __tests__/coreUiAudit.test.ts renders its launch routes under, so the count
// is a fact about the page a reader sees, not about the source.

vi.mock("server-only", () => ({}));
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    prefetch: () => Promise.resolve(),
    push: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({
  analyticsCollectionAllowed: () => false,
  trackEvent: vi.fn(),
}));
vi.mock("@/lib/cityPreference", () => ({
  mapHrefForCity: () => "/map",
  preferredCityMapHref: () => "/choose-city",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
  writePreferredCity: () => undefined,
}));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    configured: false,
    identityResolved: true,
    accountRevision: 0,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "signed-out",
    signedIn: false,
    signedOut: true,
    unresolved: false,
  }),
}));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));
vi.mock("@/components/out/EditorialRail", () => ({ default: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: () => null }));
// The server pages read their packs from disk; the gallery under /pubs and
// the scraped read behind it have their own coverage (__tests__/pubsPage.test.ts).
vi.mock("@/lib/scrapedPubs.server", () => ({
  readScrapedPubsForPage: async () => ({ pubs: [], complete: true }),
}));
vi.mock("@/components/pubs/PubsGallery", () => ({ default: () => null }));

import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { PalMeetingScreen } from "@/components/pal/PalExperience";
import SocialPageClient from "@/app/social/SocialPageClient";
import PlacesClient from "@/app/places/PlacesClient";
import DiscoverPageClient from "@/app/discover/DiscoverPageClient";
import PubsPage from "@/app/pubs/page";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

function primaryCount(rendered: string): number {
  return rendered.match(/data-primary-action/g)?.length ?? 0;
}

describe("launch routes (group b) carry one primary action", () => {
  it("/plan carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(PlanDescribeFirst, {
        onSubmit: () => undefined,
        onGuideMeInstead: () => undefined,
      }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><button[^>]*>Sort it<\/button>/);
    expect(rendered).toMatch(/<h1[^>]*>Describe the outing\. We’ll put it in order\.<\/h1>/);
  });

  it("/pal carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(PalMeetingScreen, {
        appearance: DEFAULT_PAL_DRAFT.appearance,
        onMeet: () => undefined,
      }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><button[^>]*>Meet your Pub Pal<\/button>/);
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/map"[^>]*>Back to the map<\/a>/);
  });

  it("/social carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(SocialPageClient, {
        initialState: { valid: true, tab: "posts", feed: "following", area: null },
        rivalry: [],
        heritageCrawls: [],
        friendsLaunchEnabled: true,
      }),
    );
    expect(primaryCount(rendered)).toBe(1);
    // NO PRIMARY ACTION ON A PUBLIC ROUTE IS "SIGN IN" (the launch table's own
    // opening rule). /social answers 200 to a stranger, and next.config.mjs
    // 308s /discover, /drinks and /feed here, so a painted Sign in put an
    // account wall in front of four launch addresses. A stranger's one painted
    // action is the public Pubs and pints tab; the sign-in door is the
    // boundary's quiet way onward under the answer, in the EmptyState idiom.
    expect(rendered).toMatch(
      /data-primary-action=""><a[^>]*href="\/social\?tab=discover"[^>]*>Browse pubs and pints<\/a>/,
    );
    expect(rendered).not.toMatch(/data-primary-action=""><a[^>]*>Sign in<\/a>/);
    expect(rendered).toContain('class="emptyStateTitle">Sign in to use Social.');
    expect(rendered).toMatch(
      /class="emptyStateAction"><a[^>]*href="\/login\?mode=signin&amp;from=%2Fsocial"[^>]*>Sign in<\/a>/,
    );
    expect(rendered).not.toContain("socialButton");
  });

  it("/places carries one primary action", () => {
    const rendered = renderToStaticMarkup(createElement(PlacesClient, { cityId: null }));
    expect(primaryCount(rendered)).toBe(1);
  });

  it("/discover carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(DiscoverPageClient, { rivalry: [], heritageCrawls: [] }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a[^>]*>Open the map<\/a>/);
  });

  it("/pubs carries one primary action", async () => {
    const rendered = renderToStaticMarkup(await PubsPage({}));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/);
    expect(rendered).toMatch(/<h1[^>]*>Chains \(0 chain pubs\)<\/h1>/);
  });
});
