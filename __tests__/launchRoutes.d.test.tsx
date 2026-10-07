import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

// docs/design/LAUNCH_SCREENS.md: every launch route carries ONE primary
// action, painted by the Screen primitive (components/ui/screen.tsx) and
// marked `data-primary-action`. Group d of the wave-2 surface audit (issue
// #1354): /feed, /rounds, /messages, /activity, /moment, /about, /founders,
// /contributors, /privacy, /terms, /login, /u/[handle], /plan/[id] and
// /pal/chat.
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
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
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
    handle: null,
    clerkIntegrationConfigured: false,
    socialProviders: { google: false, apple: false , microsoft: false },
    socialProvidersResolved: true,
    signInWithGoogle: async () => ({ error: null }),
    signInWithApple: async () => ({ error: null }),
    signInWithEmail: async () => ({ status: "sent", message: "" }),
    cancelAuthAttempt: () => undefined,
    signOut: async () => undefined,
    switchAccount: async () => ({ status: "switched" }),
    welcomeBack: null,
    resumeSignIn: async () => ({ status: "sent", message: "" }),
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
vi.mock("@/components/auth/useDeviceAccounts", () => ({ useDeviceAccounts: () => [] }));
vi.mock("@/components/map/useWhatsOnTonight", () => ({
  useWhatsOnTonight: () => ({
    rows: [],
    asOf: "2026-09-01T12:00:00.000Z",
    sourceObservedAt: "2026-09-01T12:00:00.000Z",
    sourceFreshnessKind: "unknown",
    kindObservedAt: {},
    status: "ready",
    retry: () => undefined,
  }),
}));
vi.mock("@/app/tonight/TonightConditionsStrip", () => ({ default: () => null }));
vi.mock("@/components/feed/PresenceStrip", () => ({ default: () => null }));
vi.mock("@/lib/anonId", () => ({ getAnonId: () => "anon-test" }));
vi.mock("@/components/profile/NextBadgeChips", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
// The profile page's panes below the hero each own their own coverage; the
// hero and its one action are what this audit counts.
vi.mock("@/components/profile/ClaimMomentWelcome", () => ({ default: () => null }));
vi.mock("@/components/profile/ContributionLanesCard", () => ({ default: () => null }));
vi.mock("@/components/profile/FirstActionsRow", () => ({ default: () => null }));
vi.mock("@/components/messages/ProfileMessageButton", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightBoard", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightCrewLine", () => ({ default: () => null }));
vi.mock("@/components/profile/OutTonightToggle", () => ({ default: () => null }));
vi.mock("@/components/profile/PintPassport", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileEditor", () => ({ default: () => null }));
vi.mock("@/components/profile/SocialLinksEditor", () => ({ default: () => null }));
vi.mock("@/components/profile/ProfileTimeline", () => ({ default: () => null }));
vi.mock("@/components/profile/PubmaxxAccountHub", () => ({ default: () => null }));
vi.mock("@/components/profile/SavedPubList", () => ({ default: () => null }));
vi.mock("@/components/wanted/WantedList", () => ({ default: () => null }));
vi.mock("@/components/profile/YourContributionsCard", () => ({ default: () => null }));
// The server pages read their stores; the reads have their own coverage
// (__tests__/foundingMembersWall.test.ts, __tests__/aboutPintIndexStory.test.ts).
vi.mock("@/lib/profileStore", () => ({
  profileStore: () => ({ listFoundingMembers: async () => [] }),
  isProfileTombstoned: () => false,
  publicOwnedImageUrl: () => null,
}));
vi.mock("@/lib/aboutStats", () => ({
  loadAboutStats: async () => ({
    pubsTracked: 12,
    pintPricesObserved: 34,
    historicPubsCited: 5,
    citiesCovered: 1,
    cheapestPint: 3.5,
    averagePint: 5.2,
    dearestPint: 7.9,
  }),
}));
vi.mock("@/lib/publicPintIndexSnapshot.server", () => ({
  loadPublicPintIndexSnapshot: async () => null,
  loadPublicPintIndexSnapshotOrThrow: async () => ({
    schemaVersion: 1,
    snapshotId: "empty-launch-fixture",
    status: "empty",
    generatedAt: "2026-09-12T00:00:00.000Z",
    observationWindow: null,
    classification: {
      version: "london-borough-point-v1",
      method: "point_in_polygon",
      sourceArtifact: "data/london_boroughs_simplified.json",
      licence: "Open Government Licence v3.0",
    },
    sources: [],
    observations: [],
    excluded: [],
  }),
}));
vi.mock("@/lib/planStore", () => ({
  // `read` is the three-way reading the page asks: a store we could not reach
  // is its own answer, never a plan that has closed (lib/planStore.ts).
  planStore: () => ({
    read: async () => ({ status: "found", state: PLAN_STATE }),
    get: async () => PLAN_STATE,
  }),
}));
vi.mock("@/lib/planCollaborationStore", () => ({
  planCollaborationStore: () => ({ vibeTally: async () => ({ ok: false }) }),
}));
vi.mock("@/components/plan/ActivePlanMarker", () => ({ default: () => null }));
vi.mock("@/components/plan/NightCrawlMode", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanInviteOpened", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanCrew", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanInviteNextStep", () => ({ default: () => null }));
vi.mock("@/components/plan/CompletedPlanUsualLot", () => ({ default: () => null }));
vi.mock("@/components/plan/LastCrewInvite", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanSummary", () => ({ default: () => null }));
vi.mock("@/components/plan/PlanVibe", () => ({ default: () => null }));

const PLAN_STATE = vi.hoisted(() => ({
  plan: {
    id: "plan-1",
    title: "Thursday in Clapham",
    startTime: "2099-01-01T19:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    status: "draft",
  },
  stops: [
    { position: 1, venueId: "venue-1", name: "The Bell" },
    { position: 2, venueId: "venue-2", name: "The Falcon" },
    { position: 3, venueId: "venue-3", name: "The Windmill" },
  ],
  crew: [],
  context: null,
  actions: [],
  ending: null,
}));

import FeedPageClient from "@/app/feed/FeedPageClient";
import RoundsIndex from "@/app/rounds/page";
import MessagesInboxClient from "@/app/messages/MessagesInboxClient";
import ActivityClient from "@/app/activity/ActivityClient";
import MomentCapture from "@/components/moment/MomentCapture";
import AboutPage from "@/app/about/page";
import FoundersPage from "@/app/founders/page";
import ContributorRecord from "@/components/contributors/ContributorRecord";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import LoginPage from "@/components/auth/LoginPage";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";
import PlanPage from "@/app/plan/[id]/page";
import PalChat from "@/components/pal/PalChat";

function primaryCount(rendered: string): number {
  return rendered.match(/data-primary-action/g)?.length ?? 0;
}

/**
 * `use(params)` reads a promise React has already settled. A thenable that
 * carries its own fulfilled status is what React reads synchronously, which
 * is the only way a route with a params promise renders to a string.
 */
function settledParams<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

describe("launch routes (group d) carry one primary action", () => {
  it("/feed carries one primary action", () => {
    const rendered = renderToStaticMarkup(createElement(FeedPageClient, {}));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /data-primary-action=""><a[^>]*href="\/map\?log=1"[^>]*>Drop a pint<\/a>/,
    );
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/map"[^>]*>Open the map<\/a>/);
  });

  it("/rounds carries one primary action", () => {
    const rendered = renderToStaticMarkup(createElement(RoundsIndex));
    expect(primaryCount(rendered)).toBe(1);
    // F18: the primary is the starter's own submit, not a link to the map.
    expect(rendered).toMatch(/<button[^>]*data-primary-action=""[^>]*>[\s\S]*Start a Round<\/button>/);
    expect(rendered).not.toMatch(/<a[^>]*href="\/map"[^>]*>Start a round<\/a>/);
    expect(rendered).toContain('class="emptyStateTitle">Join with a link');
  });

  it("/messages carries one primary action, and signed out it is the door that works", () => {
    // A static render has no session, which is the signed-out reading: the
    // one painted control is the sign-in door carrying the way back here,
    // never a New message that leads to a sign-in wall.
    const rendered = renderToStaticMarkup(createElement(MessagesInboxClient, {}));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /data-primary-action=""><a[^>]*href="\/login\?mode=signin&amp;from=%2Fmessages"[^>]*>Sign in<\/a>/,
    );
    expect(rendered).not.toContain("New message");
  });

  it("/activity carries one primary action", () => {
    const rendered = renderToStaticMarkup(createElement(ActivityClient));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/);
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/social"[^>]*>Find your lot<\/a>/);
  });

  it("/moment carries one primary action", () => {
    const rendered = renderToStaticMarkup(createElement(MomentCapture));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><button type="button">Save this Moment<\/button>/);
    expect(rendered).toMatch(/<h1[^>]*>Keep this one\.<\/h1>/);
  });

  it("/about carries one primary action", async () => {
    const rendered = renderToStaticMarkup(await AboutPage());
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/);
    expect(rendered).toMatch(/class="screenSecondary"><a href="mailto:[^"]+">Contact<\/a>/);
    expect(rendered).not.toContain("aboutBtnPrimary");
  });

  it("/founders carries one primary action", async () => {
    const rendered = renderToStaticMarkup(await FoundersPage());
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a[^>]*href="\/map"[^>]*>Open the map<\/a>/);
    // The empty wall is the EmptyState idiom, with no card and no way in.
    expect(rendered).toContain('class="emptyStateTitle"');
    expect(rendered).not.toMatch(/claim yours|hurry/i);
  });

  it("/contributors carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(ContributorRecord, {
        board: {
          status: "ready",
          window: { kind: "all-time", label: "All visible identity-backed contributions, all time" },
          entries: [],
        },
      }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a[^>]*href="\/map\?log=1"[^>]*>Drop a pint<\/a>/);
    expect(rendered).toContain('class="emptyStateTitle">No identity-backed totals yet');
  });

  // A legal page has no action (docs/design/LAUNCH_SCREENS.md): a kicker and
  // the heading, and nothing painted.
  it("/privacy carries no primary action", () => {
    const rendered = renderToStaticMarkup(createElement(PrivacyPage));
    expect(primaryCount(rendered)).toBe(0);
    expect(rendered).toMatch(/<p class="kicker">Small print<\/p><h1/);
  });

  it("/terms carries no primary action", () => {
    const rendered = renderToStaticMarkup(createElement(TermsPage));
    expect(primaryCount(rendered)).toBe(0);
    expect(rendered).toMatch(/<p class="kicker">Small print<\/p><h1/);
  });

  it("/login paints no door until the session answers, and then the form's own submit", () => {
    // A form screen's one painted control is the form's own submit, beside the
    // field it submits (captain's ruling, 7 Sep 2026). The static render is the
    // skeleton state, before the session answers, so no door is painted yet.
    const rendered = renderToStaticMarkup(createElement(LoginPage));
    expect(primaryCount(rendered)).toBe(0);
    expect(rendered).not.toContain("Send the link");
    const form = renderToStaticMarkup(
      createElement(MagicLinkForm, {
        disabled: false,
        hasSocialProviders: false,
        signInWithEmail: async () => ({ status: "sent" as const, message: "" }),
        cancelAuthAttempt: () => {},
        submitLabel: "Email me a sign-in link",
        primaryAction: true,
      }),
    );
    expect(primaryCount(form)).toBe(1);
    expect(form).toMatch(
      /<button type="submit" class="authSignIn authMagicLinkButton" data-primary-action=""[^>]*>.*Email me a sign-in link<\/button>/,
    );
    // The head names nobody until the live session answers.
    expect(rendered).toContain("Sign in or create your account");
    expect(rendered).not.toContain("Welcome back");
  });

  it("/u/[handle] carries one primary action", () => {
    const rendered = renderToStaticMarkup(
      createElement(ProfilePageClient, { params: settledParams({ handle: "alice" }) }),
    );
    expect(primaryCount(rendered)).toBe(1);
    // A stranger's Follow is the sign-in door, marked on the control itself:
    // the profile hero keeps its own composition rather than a Screen head.
    expect(rendered).toMatch(
      /<a class="profileFollowSignIn" data-primary-action="" href="\/login\?mode=signin&amp;from=%2Fu%2Falice">Sign in to follow<\/a>/,
    );
    expect(rendered).not.toContain("profileEditToggle");
  });

  it("/plan/[id] carries one primary action", async () => {
    const rendered = renderToStaticMarkup(
      await PlanPage({
        params: Promise.resolve({ id: "plan-1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(/data-primary-action=""><a href="#share">Send to the crew<\/a>/);
    expect(rendered).toMatch(/<h1[^>]*>Your night out<\/h1>/);
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/plan"[^>]*>Make another plan<\/a>/);
  });

  it("/pal/chat carries one primary action, and it is the composer's own submit", () => {
    const rendered = renderToStaticMarkup(createElement(PalChat));
    expect(primaryCount(rendered)).toBe(1);
    expect(rendered).toMatch(
      /<button type="submit" class="palChatSend pressable" data-primary-action=""/,
    );
    expect(rendered).not.toMatch(/class="screenPrimary"/);
    expect(rendered).toMatch(/class="screenSecondary"><a[^>]*href="\/pal"[^>]*>Back to your Pub Pal<\/a>/);
  });
});
