import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import OutClient from "@/app/out/OutClient";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import { PalMeetingScreen } from "@/components/pal/PalExperience";
import SocialPageClient from "@/app/social/SocialPageClient";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { defined } from "@/__tests__/helpers/defined";

const root = process.cwd();
const wordmark = readFileSync(join(root, "components/brand/PubmaxxWordmark.tsx"), "utf8");
const consent = readFileSync(join(root, "app/globals.css"), "utf8");
const tour = readFileSync(join(root, "components/onboarding/firstRunTour.css"), "utf8");
const planEntry = readFileSync(join(root, "components/plan/PlanDescribeFirst.tsx"), "utf8");
const planCss = readFileSync(join(root, "app/plan/plan.css"), "utf8");
const mobileMapCss = readFileSync(
  join(root, "components/mobile/mobileMapShell.css"),
  "utf8",
);
const nextConfig = readFileSync(join(root, "next.config.mjs"), "utf8");
const vercelIgnore = readFileSync(join(root, ".vercelignore"), "utf8");

describe("core UI audit fixes", () => {
  it("makes the near-me answer the landing hero's one primary action", () => {
    // No card behind the document here, so the quiet receipt door is the plain
    // one; __tests__/landingFindMyPintHierarchy.test.ts pins the card case.
    const rendered = renderToStaticMarkup(createElement(LandingPage));
    const hero = rendered.match(/<section class="screen lpHero"[\s\S]*?<\/section>/)?.[0];
    expect(hero, "landing hero present").toBeTruthy();
    expect(hero).toMatch(
      /data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Cheapest pints near me<\/a>/,
    );
    expect(hero?.match(/data-primary-action/g)).toHaveLength(1);
    expect(hero).toMatch(/class="screenSecondary"><a[^>]*href="\/near"[^>]*>Log what you paid<\/a>/);
  });

  it("publishes the complete PUBMAXX brand to assistive technology", () => {
    expect(wordmark).toMatch(/className=\{`pubmaxxWordmark[\s\S]*?role="img"/);
    expect(wordmark).toMatch(/aria-label=\{BRAND_NAME\}/);
  });

  it("clears mobile consent with the measured 64px tab bar", () => {
    expect(consent).toMatch(/var\(--tabbar-h,\s*64px\)/);
    expect(consent).toMatch(/--analytics-consent-mobile-clearance,\s*56px/);
  });

  it("uses a distinct neutral tone for the dearest first-visit price band", () => {
    expect(tour).toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?background:\s*color-mix\(/);
    expect(tour).not.toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?background:\s*var\(--amber\)/);
    expect(tour).not.toMatch(/\.tourLegendRow \.mapPriceDot\.red\s*\{[\s\S]*?var\(--brick\)/);
  });

  it("keeps the plan entry placeholder readable on a phone", () => {
    expect(planEntry).toMatch(/placeholder="Quiet in Clapham for 4"/);
    expect(planEntry).not.toMatch(/placeholder="[^"]*…/);
    expect(planCss).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.planPage__intro\s*\{\s*margin:\s*10px auto 10px/);
  });

  it("leaves the map's own tools up during first-session arrival", () => {
    // This used to assert the opposite: the arrival card hid the chip row, the
    // plan pill, the map-edge column and the camera controls, and the map under
    // it was `inert`. The painted-pin probe then found zero tappable marks
    // ANYWHERE on the canvas, 3 fresh contexts of 3 (docs/proof/
    // astra-live-walk/report.md B1). The ask is a strip under the top bar now
    // and it takes nothing down with it.
    expect(mobileMapCss).not.toMatch(
      /body:has\(\.mapArrivalCard\) \.mobileMapChipRow/,
    );
    expect(mobileMapCss).not.toMatch(
      /body:has\(\.mapArrivalCard\) \.mobileMapUtilityCorner/,
    );
  });

  it("does not ship removed Next experimental options", () => {
    expect(nextConfig).not.toMatch(/\bviewTransition\s*:/);
  });

  it("keeps proof and local build artifacts out of Vercel uploads", () => {
    expect(vercelIgnore).toMatch(/^\/docs\/$/m);
    expect(vercelIgnore).toMatch(/^\/\.next-\*$/m);
    expect(vercelIgnore).toMatch(/^\/coverage\/$/m);
    expect(vercelIgnore).not.toMatch(/^\/?data\/$/m);
    expect(vercelIgnore).not.toMatch(/^\/?public\/$/m);
  });

  // A .vercelignore REPLACES the .gitignore fallback, so every heavy directory
  // has to be named here or it is uploaded. `/.next-*` reads as a glob that
  // covers the build directory and does not: it matches `.next-prod` and
  // `.next-sweep` while leaving `.next` itself, the largest of them, in the
  // upload. Each line below is a directory measured at tens or hundreds of
  // megabytes that no build step reads.
  it("names every heavy directory, including the one the glob misses", () => {
    for (const entry of [
      "/.next",
      "/data-harvest/",
      "/.opencode/",
      "/.cursor/",
      "/.agents/",
      "/skills/",
      "/.firecrawl/",
      "/.tmp-evidence/",
      "/e2e-shots/",
    ]) {
      const line = new RegExp(`^${entry.replaceAll(".", "\\.")}$`, "m");
      expect(vercelIgnore, entry).toMatch(line);
    }
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
  ["/out", () => renderToStaticMarkup(createElement(OutClient, { day: "tonight" }))],
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

// Every route in docs/design/LAUNCH_SCREENS.md is rendered by a launch-route
// audit somewhere: here, or in one of the __tests__/launchRoutes.*.test.tsx
// files, whose test names open with the route path. A route may be excused
// only by name and reason below, so the table and the audits cannot drift
// apart in silence.
const NOT_RENDERED: ReadonlyArray<{ route: string; reason: string }> = [
  { route: "/map", reason: "the map canvas is another track's surface and has no heading" },
  { route: "/map/[city]", reason: "the map canvas is another track's surface and has no heading" },
  { route: "/u/you", reason: "an alias of /u/[handle], rendered under that row" },
];

/** Every table row's route, in the order the table names them. */
function tableRoutes(): string[] {
  const table = readFileSync(join(root, "docs/design/LAUNCH_SCREENS.md"), "utf8");
  const body = table.slice(0, table.indexOf("## Retired addresses"));
  return [...body.matchAll(/^\| (`[^|]+)/gm)].flatMap((m) =>
    [...defined(m[1]).matchAll(/`(\/[^`]*)`/g)].map((r) => defined(r[1])),
  );
}

describe("every launch route is rendered by an audit", () => {
  it("names each table route in a launch-route audit or excuses it by name", () => {
    const routes = tableRoutes();
    expect(routes.length).toBeGreaterThan(30);
    const audits = readdirSync(join(root, "__tests__"))
      .filter((name) => /^launchRoutes\.[a-z]+\.test\.tsx$/.test(name))
      .map((name) => readFileSync(join(root, "__tests__", name), "utf8"))
      .join("\n");
    const here = LAUNCH_SURFACES.map(([route]) => route);
    const excused = new Set(NOT_RENDERED.map((row) => row.route));
    const missing = routes.filter((route) => {
      if (excused.has(route) || route === "/" || here.includes(route)) return false;
      const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`it(?:\\.skip)?\\(\\s*["'\`]${escaped}\\s`).test(audits);
    });
    expect(missing, "table routes with no launch-route audit").toEqual([]);
  });

  // A ROUTE THE ROUTER REDIRECTS IS NOT A SCREEN. /discover, /drinks and /feed
  // held full rows in the table while next.config.mjs answered all three with a
  // permanent 308 to /social, and the audit above reported them covered because
  // two launchRoutes tests rendered the page components behind them - components
  // no reader can reach. The excuse note the table carried for /drinks was
  // itself the proof that the row was fiction, so the rows are gone and this is
  // what keeps another one from landing.
  it("names no route the router permanently redirects", () => {
    const redirected = [
      ...nextConfig.matchAll(
        /source:\s*"(\/[^"*]*)",\s*destination:\s*"([^"]+)",\s*permanent:\s*true/g,
      ),
    ].map((match) => defined(match[1]));
    expect(redirected.length, "permanent redirects read out of next.config.mjs")
      .toBeGreaterThan(2);
    const rows = new Set(tableRoutes());
    expect(
      redirected.filter((route) => rows.has(defined(route))),
      "launch table rows the router answers with a 308",
    ).toEqual([]);
  });

  // The other half: an address the table retired still has to say where it
  // went, or the next reader re-derives the router to find out.
  it("records each retired address and where the router sends it", () => {
    const table = readFileSync(join(root, "docs/design/LAUNCH_SCREENS.md"), "utf8");
    const retired = table.slice(table.indexOf("## Retired addresses"));
    expect(retired, "the table has a retired-addresses section").not.toBe("");
    for (const route of ["/discover", "/drinks", "/feed"]) {
      expect(retired, `${route} is recorded as retired`).toContain(`\`${route}\``);
    }
  });
});
