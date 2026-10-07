import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

// docs/design/LAUNCH_SCREENS.md: every launch route carries ONE primary
// action, painted by the Screen primitive (components/ui/screen.tsx) and
// marked `data-primary-action`. Group c of the wave-2 surface audit (issue
// #1354): /borough, /borough/[slug], /crawls, /crawls/[slug], /drinks,
// /drink/[slug], /historic, /historic/[slug], /pint-index and
// /pint-index/[month].
//
// Each surface renders the way a first-time visitor meets it: signed out, with
// the live session answered, every network read settled, and the chrome
// another track owns stubbed to nothing. The mock block is the one
// __tests__/coreUiAudit.test.ts renders its launch routes under, so the count
// is a fact about the page a reader sees, not about the source. The server
// pages read their bundled packs from disk, the way a request does; a dynamic
// route renders one shipped slug, named in its test.

vi.mock("server-only", () => ({}));
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "test-nonce" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  permanentRedirect: () => {
    throw new Error("permanentRedirect");
  },
  usePathname: () => "/",
  useRouter: () => ({
    prefetch: () => Promise.resolve(),
    push: () => undefined,
    replace: () => undefined,
  }),
  // /crawls reads its shared poster off `?s=`, so the search is a hoisted
  // cell the poster test may fill; every other route meets an empty query.
  useSearchParams: () => new URLSearchParams(SEARCH.current),
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
vi.mock("@/components/pal/PalPortrait", () => ({ default: () => null }));

const SEARCH = vi.hoisted(() => ({ current: "" }));

import BoroughIndexPage from "@/app/borough/page";
import BoroughPage from "@/app/borough/[slug]/page";
import CrawlsPageClient from "@/app/crawls/CrawlsPageClient";
import CrawlStoryPoster from "@/app/crawls/[slug]/CrawlStoryPoster";
import DrinkBrandLandingPage from "@/app/drink/[slug]/page";
import HistoricPage from "@/app/historic/page";
import HistoricDetailPage from "@/app/historic/[slug]/page";
import PintIndexPage from "@/app/pint-index/page";
import PintIndexEditionPage from "@/app/pint-index/[month]/page";
import { encodeCrawlStory } from "@/lib/crawlStory";
import type { DurableStory } from "@/lib/crawlStoryStore";

function primaryCount(rendered: string): number {
  return rendered.match(/data-primary-action/g)?.length ?? 0;
}

// A shared crawl the way a link carries it: the whole story in `?s=`.
const SHARED_STORY = encodeCrawlStory({
  title: "A Soho wander",
  caption: "Three rooms, one afternoon.",
  vibeTags: ["quiet pint"],
  stops: [
    { venueId: "venue-soho-1", name: "The Coach and Horses", priceGbp: 6.2 },
    { venueId: "venue-soho-2", name: "The French House", priceGbp: null },
  ],
});

// A durable Crawl Story as the store hands it back: stop names and map links
// already resolved on the server, no author. There is no shipped slug for this
// route, because every durable story is written by a drinker, so the audit
// renders the poster with a fixture the store's read shape describes.
const DURABLE_STORY: DurableStory = {
  slug: "a-soho-wander",
  title: "A Soho wander",
  summary: "Three rooms, one afternoon.",
  visibility: "public",
  vibeTags: ["quiet pint"],
  authorHandle: null,
  stops: [
    {
      venueId: "venue-soho-1",
      venueName: "The Coach and Horses",
      venueMapUrl: "/map?sel=venue-soho-1",
      priceGbp: 6.2,
      position: 0,
    },
    {
      venueId: "venue-soho-2",
      venueName: "The French House",
      venueMapUrl: "/map?sel=venue-soho-2",
      priceGbp: null,
      position: 1,
    },
  ],
  totalGbp: 6.2,
  createdAt: "2026-09-01T12:00:00.000Z",
};

describe("launch routes (group c) carry one primary action", () => {
  it("/borough carries one primary action", async () => {
    const rendered = renderToStaticMarkup(await BoroughIndexPage());
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/,
    );
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/near"[^>]*>Find my pint<\/a>/);
    expect(rendered).toMatch(/<h1[^>]*>London, by the area you drink in\.<\/h1>/);
  });

  it("/borough/[slug] carries one primary action (camden)", async () => {
    const rendered = renderToStaticMarkup(
      await BoroughPage({ params: Promise.resolve({ slug: "camden" }) }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map\?q=Camden"[^>]*>Open the map here<\/a>/,
    );
    expect(rendered).toMatch(/<h1[^>]*>Pubs in Camden\.<\/h1>/);
    // The crawl deep-link under the head stays a text link, not a second button.
    expect(rendered).toContain("Start a crawl from cheapest pubs");
  });

  it("/crawls carries one primary action", () => {
    SEARCH.current = "";
    const rendered = renderToStaticMarkup(createElement(CrawlsPageClient));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map\?[^"]*"[^>]*>Start a crawl<\/a>/,
    );
    expect(rendered).toMatch(/<h1[^>]*>Pub stories mapped into walks\.<\/h1>/);
    // The featured card's own way onto the map reads as a link, never as the
    // filled control the old grid painted on every card.
    expect(rendered).not.toContain("curatedLink");
  });

  it("/crawls carries one primary action on a shared poster (?s=)", () => {
    SEARCH.current = `s=${SHARED_STORY}`;
    try {
      const rendered = renderToStaticMarkup(createElement(CrawlsPageClient));
      expect(primaryCount(rendered)).toBe(1);
      expect(rendered).toMatch(
        /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map\?mode=build&amp;pubs=venue-soho-1%2Cvenue-soho-2"[^>]*>Start this crawl<\/a>/,
      );
      expect(rendered).toMatch(/<h1[^>]*>A Soho wander<\/h1>/);
      expect(rendered).not.toContain("crawlPrimaryBtn");
    } finally {
      SEARCH.current = "";
    }
  });

  it("/crawls/[slug] carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(CrawlStoryPoster, { story: DURABLE_STORY, slug: DURABLE_STORY.slug }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map\?mode=build&amp;pubs=venue-soho-1%2Cvenue-soho-2"[^>]*>Start this crawl<\/a>/,
    );
    expect(rendered).toMatch(/<h1[^>]*>A Soho wander<\/h1>/);
    expect(rendered).not.toContain("storyPrimaryBtn");
  });

  // /drinks has no case here: next.config.mjs 308s it to /social?tab=discover and
  // app/drinks/page.tsx is the same permanentRedirect, so the route renders no
  // document of its own and has no primary action to count.

  it("/drink/[slug] carries one primary action (guinness)", async () => {
    const rendered = renderToStaticMarkup(
      await DrinkBrandLandingPage({ params: Promise.resolve({ slug: "guinness" }) }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map[^"]*"[^>]*>Open the map<\/a>/,
    );
    expect(rendered).toMatch(/<h1[^>]*>Cheapest Guinness pints in London<\/h1>/);
    expect(rendered).not.toContain("drinkBrandDirectory__primary");
  });

  it("/historic carries one primary action", async () => {
    const rendered = renderToStaticMarkup(
      await HistoricPage({ searchParams: Promise.resolve({}) }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/,
    );
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/crawls"[^>]*>Start a crawl<\/a>/);
  });

  it("/historic/[slug] carries one primary action (prospect-of-whitby)", async () => {
    const rendered = renderToStaticMarkup(
      await HistoricDetailPage({ params: Promise.resolve({ slug: "prospect-of-whitby" }) }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map\?sel=venue-[^"]+"[^>]*>Open on the map<\/a>/,
    );
    expect(rendered).toMatch(
      /class="screenSecondary"><a[^>]*href="\/map\?mode=build&amp;pubs=venue-[^"]+"[^>]*>Plan a night here<\/a>/,
    );
    expect(rendered).toMatch(/<h1[^>]*>Prospect of Whitby<\/h1>/);
    expect(rendered).not.toContain("hdActionPrimary");
  });

  it("/pint-index carries one primary action", async () => {
    const rendered = renderToStaticMarkup(await PintIndexPage());
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/,
    );
    // The checked-in snapshot has no rows yet, so there is no CSV door to offer.
    // `__tests__/pintIndexDownloadDoor.test.tsx` holds the populated side.
    expect(rendered).not.toContain("Download the CSV");
  });

  it("/pint-index/[month] carries one primary action (2026-06)", async () => {
    const rendered = renderToStaticMarkup(
      await PintIndexEditionPage({ params: Promise.resolve({ month: "2026-06" }) }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/,
    );
    expect(rendered).not.toContain("Download the CSV");
    expect(rendered).toContain("These figures stay put");
  });
});
