import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthogState = vi.hoisted(() => ({
  identify: vi.fn(),
  reset: vi.fn(),
  client: null as {
    identify: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock("@/lib/analytics", () => ({
  analyticsCollectionAllowed: () => true,
}));

vi.mock("@/lib/posthogClient", () => ({
  loadPosthogClientForIdentity: () => Promise.resolve(posthogState.client),
  syncPosthogConsent: vi.fn(),
}));

describe("PostHog person identity", () => {
  afterEach(() => {
    posthogState.identify.mockClear();
    posthogState.reset.mockClear();
    posthogState.client = null;
    vi.resetModules();
    delete (globalThis as { window?: unknown }).window;
  });

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
  });

  it("identifies only internal Supabase user ids", async () => {
    posthogState.client = {
      identify: posthogState.identify,
      reset: posthogState.reset,
    };
    const { syncPosthogPersonIdentity, isInternalAnalyticsUserId } = await import("@/lib/posthog/posthogPerson");
    expect(isInternalAnalyticsUserId("not-a-uuid")).toBe(false);
    expect(isInternalAnalyticsUserId("018f47a2-8e71-7a7a-9f18-8b953d45b2da")).toBe(true);

    syncPosthogPersonIdentity("018f47a2-8e71-7a7a-9f18-8b953d45b2da");
    await vi.waitFor(() => expect(posthogState.identify).toHaveBeenCalledWith("018f47a2-8e71-7a7a-9f18-8b953d45b2da"));

    syncPosthogPersonIdentity("person@example.com");
    await vi.waitFor(() => expect(posthogState.identify).toHaveBeenCalledTimes(1));
  });

  it("resets on sign-out and re-syncs consent capture", async () => {
    const { syncPosthogConsent } = await import("@/lib/posthogClient");
    posthogState.client = {
      identify: posthogState.identify,
      reset: posthogState.reset,
    };
    const { syncPosthogPersonIdentity } = await import("@/lib/posthog/posthogPerson");
    syncPosthogPersonIdentity(null);
    await vi.waitFor(() => expect(posthogState.reset).toHaveBeenCalledWith(true));
    expect(syncPosthogConsent).toHaveBeenCalledWith(true);
  });
});
