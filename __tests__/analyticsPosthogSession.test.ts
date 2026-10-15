import { afterEach, describe, expect, it, vi } from "vitest";

// A named product event rides /api/events, not the browser SDK, so it carries
// the SDK's session id itself or it never joins the pageviews and $web_vitals
// of the same visit in PostHog.
const posthog = vi.hoisted(() => ({ sessionId: null as string | null }));

vi.mock("@/lib/posthogClient", () => ({
  capturePosthogPageview: vi.fn(),
  syncPosthogConsent: vi.fn(),
  posthogSessionId: () => posthog.sessionId,
}));

import { setAnalyticsConsent, trackEvent } from "@/lib/analytics";

const SESSION_ID = "019a1b2c-3d4e-7f60-8a1b-2c3d4e5f6071";

function setWindow(): ReturnType<typeof vi.fn> {
  const values = new Map<string, string>();
  const sendBeacon = vi.fn().mockReturnValue(true);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { sendBeacon },
  });
  (globalThis as { window?: unknown }).window = {
    location: { origin: "https://pubmaxxing.com", pathname: "/tonight" },
    document: { referrer: "" },
    screen: { width: 390, height: 844 },
    innerWidth: 390,
    innerHeight: 844,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
  return sendBeacon;
}

async function sentContext(sendBeacon: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  const blob = sendBeacon.mock.calls[0]?.[1] as Blob;
  return (JSON.parse(await blob.text()) as { context: Record<string, unknown> }).context;
}

afterEach(() => {
  posthog.sessionId = null;
  if ((globalThis as { window?: unknown }).window) setAnalyticsConsent(false);
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe("trackEvent and the browser SDK session", () => {
  it("sends the SDK session id so the forwarded event joins its session", async () => {
    const sendBeacon = setWindow();
    setAnalyticsConsent(true);
    posthog.sessionId = SESSION_ID;

    trackEvent("tonight_screen_view");

    expect(await sentContext(sendBeacon)).toMatchObject({ sessionId: SESSION_ID });
  });

  it("sends no session id before the SDK has one", async () => {
    const sendBeacon = setWindow();
    setAnalyticsConsent(true);

    trackEvent("tonight_screen_view");

    expect(await sentContext(sendBeacon)).not.toHaveProperty("sessionId");
  });
});
