import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/u/you",
  useRouter: () => ({
    prefetch: () => Promise.resolve(),
    push: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/nav/NowSegment", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: null,
    loading: true,
    configured: true,
    identityResolved: false,
    accountRevision: 0,
    handle: null,
    getCurrentUserId: () => null,
    supabaseAuthState: "unresolved",
    providerAuthState: "unknown",
    signOut: async () => undefined,
  }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: "unresolved",
    signedIn: false,
    signedOut: false,
    unresolved: true,
  }),
}));
vi.mock("@/components/profile/PubmaxxAccountHub", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({
  analyticsCollectionAllowed: () => false,
  trackEvent: vi.fn(),
}));

import PalExperience from "@/components/pal/PalExperience";
import ProfilePageClient from "@/app/u/[handle]/ProfilePageClient";

const WANTED_LEDE =
  "Paste a pub name or a link you saved elsewhere. It becomes a place you can plan around.";
const PAL_TITLE = "A little signal that becomes yours.";

function settledParams<T>(value: T): Promise<T> {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

describe("hydration-gated static copy is in the server HTML", () => {
  it("/u/you paints the Wanted lede before identity answers", () => {
    const html = renderToStaticMarkup(
      createElement(ProfilePageClient, { params: settledParams({ handle: "you" }) }),
    );

    expect(html).toContain('class="wantedPanel__lede"');
    expect(html).toContain(WANTED_LEDE);
    expect(html).toContain("profileIdentityLoadingSurface");
    expect(html).not.toContain("Make the night yours.");
    expect(html).not.toContain("Sign in to keep a Wanted list");
  });

  it("keeps the Wanted body off /u/you's identity-loading JS", () => {
    const wantedList = readFileSync(
      join(process.cwd(), "components/wanted/WantedList.tsx"),
      "utf8",
    );
    const profilePage = readFileSync(
      join(process.cwd(), "app/u/[handle]/ProfilePageClient.tsx"),
      "utf8",
    );
    expect(wantedList).toMatch(
      /const WantedListBody = dynamic\(\(\) => import\(["']\.\/WantedListBody["']\)/,
    );
    expect(wantedList).toMatch(/ssr:\s*false/);
    expect(wantedList).not.toMatch(/import WantedCapture from/);
    expect(wantedList).not.toMatch(/from ["']@\/lib\/wanted["']/);
    expect(profilePage).toContain('body={surface === "you-invitation" && documentComplete}');
    expect(profilePage).toMatch(
      /const PubmaxxAccountHub = dynamic\(\s*\(\) => import\(["']@\/components\/profile\/PubmaxxAccountHub["']\)/,
    );
  });

  it("/pal paints the meeting heading before the Pal is ready", () => {
    const html = renderToStaticMarkup(createElement(PalExperience));

    expect(html).toContain('id="pal-meeting-title"');
    expect(html).toContain(PAL_TITLE);
    expect(html).toContain("Your Pub Pal");
    expect(html).toContain("Pick its look and voice");
    expect(html).not.toContain("Waking your Pub Pal");
  });
});
