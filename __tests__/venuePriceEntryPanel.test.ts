import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenuePriceEntryPanel from "@/components/map/inspector/VenuePriceEntryPanel";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const analytics = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: analytics.trackEvent,
}));

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map([
    [
      "venue-fixture",
      [
        {
          venueId: "venue-fixture",
          signalKey: "character",
          signalValue: "rough",
          submittedAt: Date.parse("2026-07-29T20:00:00Z"),
          source: "community",
          corroborations: 1,
        },
      ],
    ],
  ]),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map([["venue-fixture", "ready"]]),
  loadVenue: vi.fn(),
  submit: vi.fn(),
  submitVenueSignal: vi.fn(),
  submitting: false,
} as unknown as CommunityPricesState;

function renderEntry({
  canSubmitPrice,
  showSignInGate,
  initialCategory,
}: {
  canSubmitPrice: boolean;
  showSignInGate: boolean;
  initialCategory?: "beer" | "coffee" | "soft-drink" | "alcohol-free" | null;
}): string {
  return renderToStaticMarkup(
    createElement(VenuePriceEntryPanel, {
      venueId: "venue-fixture",
      venueName: "Fixture Arms",
      communityPrices,
      canSubmitPrice,
      showSignInGate,
      authLoading: false,
      focusRequest: 1,
      initialCategory: initialCategory ?? null,
    }),
  );
}

describe("price contribution auth destination", () => {
  it("takes a signed-out drinker to an account-first gate before the form", () => {
    authState.current = {
      user: null,
      loading: false,
      configured: true,
      socialProviders: { google: false, microsoft: false },
      signInWithGoogle: vi.fn(),
      signInWithMicrosoft: vi.fn(),
      signInWithEmail: vi.fn(),
      cancelAuthAttempt: vi.fn(),
      signOut: vi.fn(),
    };

    const html = renderEntry({
      canSubmitPrice: false,
      showSignInGate: true,
    });

    expect(html).toContain("Sign in to add a price");
    expect(html).toContain("You need an account to add a price.");
    expect(html).toContain("Email me a link");
    expect(html).not.toContain("venuePriceSubmit");
    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("One drinker called it rough.");
    expect(html).toContain("Sign in to add what you noticed.");
    expect(html).not.toContain("Add what you noticed");
  });

  it("takes an injected signed-in state to the existing price form", () => {
    authState.current = {
      user: { id: "signed-in-drinker" },
      loading: false,
      configured: true,
    };
    const html = renderEntry({
      canSubmitPrice: true,
      showSignInGate: true,
    });

    expect(html).toContain("venuePriceSubmit");
    expect(html).toContain("What’s it tonight?");
    expect(html).toContain(
      'aria-label="Price of a beer at Fixture Arms, in pounds"',
    );
    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("Add what you noticed");
    expect(html).not.toContain("Sign in to add a price");
    expect(html).not.toContain("Sign in to add what you noticed.");
  });

  it("keeps public signal reads but no composer before price contribution", () => {
    const html = renderEntry({
      canSubmitPrice: false,
      showSignInGate: false,
    });

    expect(html).toContain("What drinkers noticed");
    expect(html).toContain("One drinker called it rough.");
    expect(html).not.toContain("venuePriceSubmit");
    expect(html).not.toContain("Sign in to add a price");
    expect(html).not.toContain("Add what you noticed");
  });
});

describe("price submit opens on the active drink lens", () => {
  it("preselects coffee and drops the tonight heading under a coffee lens", () => {
    authState.current = {
      user: { id: "signed-in-drinker" },
      loading: false,
      configured: true,
    };
    const html = renderEntry({
      canSubmitPrice: true,
      showSignInGate: false,
      initialCategory: "coffee",
    });

    expect(html).toContain("What’s the coffee?");
    expect(html).not.toContain("What’s it tonight?");
    expect(html).toContain(
      'aria-label="Price of a coffee at Fixture Arms, in pounds"',
    );
    expect(html).toContain('class="vpsubCat vpsubCatOn"');
    expect(html).toContain(">Coffee</button>");
  });

  it("preselects soft-drink with an outing-neutral heading", () => {
    authState.current = {
      user: { id: "signed-in-drinker" },
      loading: false,
      configured: true,
    };
    const html = renderEntry({
      canSubmitPrice: true,
      showSignInGate: false,
      initialCategory: "soft-drink",
    });

    expect(html).toContain("What’s the soft drink?");
    expect(html).not.toContain("What’s it tonight?");
    expect(html).toContain(">Soft drinks</button>");
  });

  it("preselects alcohol-free without asking about tonight", () => {
    authState.current = {
      user: { id: "signed-in-drinker" },
      loading: false,
      configured: true,
    };
    const html = renderEntry({
      canSubmitPrice: true,
      showSignInGate: false,
      initialCategory: "alcohol-free",
    });

    expect(html).toContain("What’s the alcohol-free?");
    expect(html).not.toContain("What’s it tonight?");
  });
});
