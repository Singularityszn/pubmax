import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

// Wave 2 of the surface audit (issue #1354), group a: /near, /today, /tonight
// and /out. Each route's head is the Screen primitive, which marks the ONE
// primary action, so the whole rendered page must count exactly one
// `data-primary-action`. The mocks are the ones __tests__/coreUiAudit.test.ts
// uses: a first-time visitor, signed out, with the live session answered and
// the chrome another track owns stubbed to nothing.

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

import NearPageClient from "@/components/nearme/NearPageClient";
import TodayClient from "@/app/today/TodayClient";
import TonightClient from "@/app/tonight/TonightClient";
import OutClient from "@/app/out/OutClient";

function renderNear(): string {
  return renderToStaticMarkup(createElement(NearPageClient));
}

function renderToday(): string {
  return renderToStaticMarkup(
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
  );
}

function renderTonight(): string {
  return renderToStaticMarkup(
    createElement(TonightClient, {
      quietPint: null,
    }),
  );
}

function renderOut(): string {
  return renderToStaticMarkup(createElement(OutClient, { day: "tonight" }));
}

describe("launch routes (group a) carry one primary action", () => {
  it("/near carries one primary action", () => {
    const rendered = renderNear();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><button type="button">[\s\S]*?Find my pint<\/button>/,
    );
  });

  it("/today carries one primary action", () => {
    const rendered = renderToday();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/near\?locate=1"[^>]*>Find my pint<\/a>/,
    );
    // The getting-home card keeps its near entry as a quiet text link.
    expect(rendered).toContain("Find pubs near you");
  });

  it("/tonight carries one primary action", () => {
    const rendered = renderTonight();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map"[^>]*>See them on the map<\/a>/,
    );
  });

  it("/out carries one primary action", () => {
    const rendered = renderOut();
    expect(rendered.match(/data-primary-action/g)).toHaveLength(1);
    expect(rendered).toMatch(
      /class="screenPrimary" data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/,
    );
    // The empty lane's own map link stays unmarked so the page counts one.
    expect(rendered).toMatch(/class="emptyStateAction"><a[^>]*href="\/map"[^>]*>Open the map<\/a>/);
  });
});
