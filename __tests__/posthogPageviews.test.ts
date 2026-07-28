import { afterEach, describe, expect, it, vi } from "vitest";

const posthogState = vi.hoisted(() => ({
  captures: [] as Array<[string, Record<string, unknown>]>,
  initCount: 0,
  moduleLoads: 0,
  optedOut: true,
}));

vi.mock("posthog-js", () => {
  posthogState.moduleLoads += 1;
  return {
    default: {
      capture: (name: string, properties: Record<string, unknown>) => {
        if (!posthogState.optedOut) posthogState.captures.push([name, properties]);
      },
      init: () => { posthogState.initCount += 1; },
      opt_in_capturing: () => { posthogState.optedOut = false; },
      opt_out_capturing: () => { posthogState.optedOut = true; },
    },
  };
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  posthogState.captures = [];
  posthogState.initCount = 0;
  posthogState.moduleLoads = 0;
  posthogState.optedOut = true;
  delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
});

describe("explicit PostHog pageviews", () => {
  it("holds the initial route until consent initializes the SDK, then captures route changes once", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");

    syncPosthogConsent(true);
    capturePosthogPageview("/tonight", "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da");
    expect(posthogState.captures).toEqual([]);

    await vi.waitFor(() => {
      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/tonight",
          $pubmaxx_anonymous_id: "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da",
        }],
      ]);
    });

    capturePosthogPageview("/tonight", "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da");
    capturePosthogPageview("/map", "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da");

    expect(posthogState.captures).toEqual([
      ["$pageview", {
        $pathname: "/tonight",
        $pubmaxx_anonymous_id: "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da",
      }],
      ["$pageview", {
        $pathname: "/map",
        $pubmaxx_anonymous_id: "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da",
      }],
    ]);
  });

  it("discards a queued pageview when consent is declined", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");

    syncPosthogConsent(true);
    capturePosthogPageview("/map", "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da");
    syncPosthogConsent(false);
    syncPosthogConsent(true);

    await vi.waitFor(() => expect(posthogState.initCount).toBe(1));
    expect(posthogState.captures).toEqual([]);
  });

  it("waits for the SDK to opt back in before capturing after re-consent", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/tonight", anonymousId);
    await vi.waitFor(() => expect(posthogState.captures).toHaveLength(1));

    syncPosthogConsent(false);
    syncPosthogConsent(true);
    capturePosthogPageview("/map", anonymousId);

    await vi.waitFor(() => {
      expect(posthogState.captures.at(-1)).toEqual([
        "$pageview",
        {
          $pathname: "/map",
          $pubmaxx_anonymous_id: anonymousId,
        },
      ]);
    });
  });

  it("rejects a route containing data outside the pathname", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");

    capturePosthogPageview("/map?sel=venue-secret", "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da");
    syncPosthogConsent(true);

    await vi.waitFor(() => expect(posthogState.initCount).toBe(1));
    expect(posthogState.captures).toEqual([]);
  });

  it("queues only a stable template for a dynamic route", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const {
      capturePosthogPageview,
      syncPosthogConsent,
    } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    syncPosthogConsent(true);
    capturePosthogPageview("/messages/private-thread", anonymousId);

    await vi.waitFor(() => {
      expect(posthogState.captures).toEqual([
        ["$pageview", {
          $pathname: "/messages/[id]",
          $pubmaxx_anonymous_id: anonymousId,
        }],
      ]);
    });
    expect(JSON.stringify(posthogState.captures)).not.toContain("private-thread");

    capturePosthogPageview("/messages/second-private-thread", anonymousId);
    expect(posthogState.captures).toHaveLength(2);
    expect(posthogState.captures[1]?.[1].$pathname).toBe("/messages/[id]");
    expect(JSON.stringify(posthogState.captures)).not.toContain("second-private-thread");
  });
});
