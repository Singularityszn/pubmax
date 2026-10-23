import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

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
}));

// The launch routes below render as a first-time visitor meets them: signed
// out, with the live session answered, and the chrome another track owns
// stubbed to nothing. Every hook that reads over the network answers a settled
// state, so the surface under test is the one a reader sees, not a skeleton.
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null, SiteNavActions: () => null }));
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
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({
    rows: [TONIGHT_ROW],
    asOf: "2026-09-01T12:00:00.000Z",
    sourceObservedAt: "2026-09-01T12:00:00.000Z",
    sourceFreshnessKind: "unknown",
    kindObservedAt: {},
    status: "ready",
    retry: () => undefined,
  }),
}));
vi.mock("@/components/out/useOutListings", () => ({
  useOutListings: () => ({
    body: OUT_EMPTY_BODY,
    failed: false,
    pending: false,
    retry: () => undefined,
  }),
}));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightGetHomeStrip", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightShareButton", () => ({ default: () => null }));
vi.mock("@/components/desktop/AreaNewsRail", () => ({ default: () => null }));
vi.mock("@/components/discovery/DealsTonightLane", () => ({ default: () => null }));
vi.mock("@/components/discovery/MusicTonightLane", () => ({ default: () => null }));
vi.mock("@/components/out/EditorialRail", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/components/founding/FoundersWallLink", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/FindYourLot", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/components/social/StarterPacks", () => ({ default: () => null }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: () => null }));

const TONIGHT_ROW = vi.hoisted(() => ({
  id: "quiz-bell",
  kind: "quiz",
  title: "Quiz night",
  venueId: "venue-bell",
  placeName: "The Bell",
  startsAt: "2099-01-01T20:00:00.000Z",
  source: { label: "The Bell", url: "https://example.com/quiz" },
  observedAt: "2026-09-01T12:00:00.000Z",
  confidence: "listed",
}));
const OUT_EMPTY_BODY = vi.hoisted(() => ({
  status: "ready",
  listingsStatus: "ready",
  events: [],
  openPlans: [],
  attribution: [],
  observedAt: {},
  providers: [],
  venueMatch: "ready",
}));

import LandingPage from "@/components/landing/LandingPage";
import NearPageClient from "@/components/nearme/NearPageClient";
import TodayClient from "@/app/today/TodayClient";
import TonightClient from "@/app/tonight/TonightClient";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { PalMeetingScreen } from "@/components/pal/PalExperience";
import SocialPageClient from "@/app/social/SocialPageClient";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { defined } from "@/__tests__/helpers/defined";

// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const root = process.cwd();
const nextConfig = nextConfigModule as NextConfig;

describe("core UI audit fixes", () => {
  it("makes the near-me answer the landing hero's one primary action", () => {
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const hero = rendered.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0];
    expect(hero, "landing hero present").toBeTruthy();
    expect(hero).toMatch(
      /data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Cheapest pints near me<\/a>/,
    );
    expect(hero?.match(/data-primary-action/g)).toHaveLength(1);
    expect(hero).toMatch(/class="screenSecondary"><a[^>]*href="\/map\?log=1"[^>]*>Log what you paid<\/a>/);
  });

  it("renders the complete plan entry example", () => {
    const rendered = renderToStaticMarkup(createElement(PlanDescribeFirst, {
      onSubmit: () => undefined,
      onGuideMeInstead: () => undefined,
    }));
    expect(rendered).toContain('placeholder="Quiet in Clapham for 4"');
  });

  it("does not ship removed Next experimental options", () => {
    expect(nextConfig.experimental).not.toHaveProperty("viewTransition");
  });
});

// docs/design/LAUNCH_SCREENS.md: every launch route carries ONE primary action,
// marked `data-primary-action` on the control or the wrapper that is its own.
// Each surface renders the way a first-time visitor meets it (the mocks at the
// top of this file), so the count is a fact about the page, not the source.
const LAUNCH_SURFACES: ReadonlyArray<[string, () => string]> = [
  ["/near", () => renderToStaticMarkup(createElement(NearPageClient))],
  [
    "/today",
    () =>
      renderToStaticMarkup(
        createElement(TodayClient, {
          dateLabel: "Thursday 3 September",
          nowIso: "2026-09-03T12:00:00.000Z",
          greeting: {
            slot: "afternoon",
            salutation: "Good afternoon",
            headline: "Your day out, sorted.",
            support: "Tonight's best, how you'll get home, and one to remember.",
            weatherAware: false,
          },
          weather: null,
          weatherByArea: {},
          picks: [],
          picksStatus: "ready",
          fact: null,
          pintsIndex: {},
          quietPint: null,
        }),
      ),
  ],
  [
    "/tonight",
    () =>
      renderToStaticMarkup(
        createElement(TonightClient, {
          quietPint: null,
        }),
      ),
  ],
  [
    "/plan",
    () =>
      renderToStaticMarkup(
        createElement(PlanDescribeFirst, {
          onSubmit: () => undefined,
          onGuideMeInstead: () => undefined,
        }),
      ),
  ],
  [
    "/pal",
    () =>
      renderToStaticMarkup(
        createElement(PalMeetingScreen, {
          appearance: DEFAULT_PAL_DRAFT.appearance,
          onMeet: () => undefined,
        }),
      ),
  ],
  [
    "/social",
    () =>
      renderToStaticMarkup(
        createElement(SocialPageClient, {
          initialState: { valid: true, tab: "posts", feed: "following", area: null },
          rivalry: [],
          heritageCrawls: [],
          friendsLaunchEnabled: true,
        }),
      ),
  ],
];

describe("launch routes carry one primary action", () => {
  it.each(LAUNCH_SURFACES)("%s marks exactly one primary action", (_route, render) => {
    const rendered = render();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
  });
});

/** Every table row's route, in the order the table names them. */
function tableRoutes(): string[] {
  const table = readFileSync(join(root, "docs/design/LAUNCH_SCREENS.md"), "utf8");
  const body = table.slice(0, table.indexOf("## Retired addresses"));
  return [...body.matchAll(/^\| (`[^|]+)/gm)].flatMap((m) =>
    [...defined(m[1]).matchAll(/`(\/[^`]*)`/g)].map((r) => defined(r[1])),
  );
}

describe("the launch-route document matches router configuration", () => {
  it("names no route the router permanently redirects", async () => {
    const redirected = (await nextConfig.redirects?.() ?? [])
      .filter((rule) => rule.permanent === true)
      .map((rule) => rule.source);
    expect(redirected.length, "permanent redirects returned by the router configuration")
      .toBeGreaterThan(2);
    const rows = new Set(tableRoutes());
    expect(
      redirected.filter((route) => rows.has(route)),
      "launch table rows the router answers with a 308",
    ).toEqual([]);
  });

  // The other half: an address the table retired still has to say where it
  // went, or the next reader re-derives the router to find out.
  it("records each retired address and where the router sends it", () => {
    const table = readFileSync(join(root, "docs/design/LAUNCH_SCREENS.md"), "utf8");
    const retired = table.slice(table.indexOf("## Retired addresses"));
    expect(retired, "the table has a retired-addresses section").not.toBe("");
    for (const route of ["/discover", "/drinks", "/feed", "/out"]) {
      expect(retired, `${route} is recorded as retired`).toContain(`\`${route}\``);
    }
  });
});
