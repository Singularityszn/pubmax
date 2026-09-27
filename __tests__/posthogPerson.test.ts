import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_A = "018f47a2-8e71-7a7a-9f18-8b953d45b2da";
const USER_B = "018f47a2-8e71-7a7a-9f18-8b953d45b2db";
const ANON_ID = "anon_0123456789abcdef";

const posthogState = vi.hoisted(() => ({
  distinctId: "",
  client: null as {
    get_distinct_id: () => string;
    identify: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  } | null,
  syncPosthogConsent: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  analyticsCollectionAllowed: () => true,
}));

vi.mock("@/lib/posthogClient", () => ({
  loadPosthogClientForIdentity: () => Promise.resolve(posthogState.client),
  syncPosthogConsent: posthogState.syncPosthogConsent,
}));

import { isInternalAnalyticsUserId, syncPosthogPersonIdentity } from "@/lib/posthog/posthogPerson";

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("PostHog person identity", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });
    posthogState.distinctId = ANON_ID;
    posthogState.client = {
      get_distinct_id: () => posthogState.distinctId,
      identify: vi.fn((id: string) => {
        posthogState.distinctId = id;
      }),
      reset: vi.fn(),
    };
    posthogState.syncPosthogConsent.mockReset();
  });

  afterEach(() => {
    posthogState.client = null;
    delete (globalThis as { window?: unknown }).window;
  });

  it("identifies only internal Supabase user ids", async () => {
    expect(isInternalAnalyticsUserId("not-a-uuid")).toBe(false);
    expect(isInternalAnalyticsUserId(USER_A)).toBe(true);

    syncPosthogPersonIdentity("person@example.com");
    await flush();
    expect(posthogState.client?.identify).not.toHaveBeenCalled();

    syncPosthogPersonIdentity(USER_A);
    await flush();
    expect(posthogState.client?.identify).toHaveBeenCalledWith(USER_A);
  });

  it("leaves the session alone when a token refresh repeats the same person", async () => {
    syncPosthogPersonIdentity(USER_A);
    await flush();
    syncPosthogPersonIdentity(USER_A);
    syncPosthogPersonIdentity(USER_A);
    await flush();

    expect(posthogState.client?.identify).toHaveBeenCalledOnce();
    expect(posthogState.client?.reset).not.toHaveBeenCalled();
    expect(posthogState.syncPosthogConsent).not.toHaveBeenCalled();
  });

  it("identifies again when the account changes", async () => {
    syncPosthogPersonIdentity(USER_A);
    await flush();
    syncPosthogPersonIdentity(USER_B);
    await flush();
    expect(posthogState.client?.identify).toHaveBeenLastCalledWith(USER_B);
  });

  it("never resets an anonymous visitor", async () => {
    syncPosthogPersonIdentity(null);
    syncPosthogPersonIdentity(null);
    await flush();
    expect(posthogState.client?.reset).not.toHaveBeenCalled();
    expect(posthogState.syncPosthogConsent).not.toHaveBeenCalled();
  });

  it("re-seeds the anonymous device identity once on sign-out", async () => {
    syncPosthogPersonIdentity(USER_A);
    await flush();
    syncPosthogPersonIdentity(null);
    await flush();
    expect(posthogState.syncPosthogConsent).toHaveBeenCalledOnce();
    expect(posthogState.syncPosthogConsent).toHaveBeenCalledWith(true);
  });
});
