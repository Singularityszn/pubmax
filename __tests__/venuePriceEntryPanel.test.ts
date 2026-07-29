import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import VenuePriceEntryPanel from "@/components/map/inspector/VenuePriceEntryPanel";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

const communityPrices = {
  byVenueId: new Map(),
  signalsByVenueId: new Map(),
  freshestByVenueId: new Map(),
  venuePriceStatus: new Map(),
  loadVenue: vi.fn(),
  submit: vi.fn(),
  submitVenueSignal: vi.fn(),
  submitting: false,
} as unknown as CommunityPricesState;

function renderEntry({
  canSubmitPrice,
  showSignInGate,
}: {
  canSubmitPrice: boolean;
  showSignInGate: boolean;
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
    expect(html).not.toContain("Sign in to add a price");
  });

  it("adds no Overview content before a signed-out drinker asks to contribute", () => {
    expect(
      renderEntry({
        canSubmitPrice: false,
        showSignInGate: false,
      }),
    ).toBe("");
  });
});
