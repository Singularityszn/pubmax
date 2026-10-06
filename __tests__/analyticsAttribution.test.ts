import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_ENVIRONMENTS,
  ANALYTICS_SCHEMA_VERSION,
  analyticsAttributionProps,
  analyticsBuildEnv,
  isAnalyticsEnvironment,
  normalizeAnalyticsRelease,
  readAnalyticsAttribution,
  resolveAnalyticsEnvironment,
} from "@/lib/analyticsAttribution.mjs";
import { ANALYTICS_EVENTS } from "@/lib/analyticsEvents";
import { defined } from "@/__tests__/helpers/defined";

const PRODUCTION_SHA = "5bf044f55a1b2c3d4e5f60718293a4b5c6d7e8f9";
const PREVIEW_SHA = "1d716d930a1b2c3d4e5f60718293a4b5c6d7e8f9";

/** The names attribution owns. No registry event may claim one of them. */
const ATTRIBUTION_PROP_NAMES = ["environment", "release", "schema_version"];

describe("the analytics environment vocabulary", () => {
  it("is a closed set of four lanes", () => {
    expect([...ANALYTICS_ENVIRONMENTS]).toEqual([
      "production",
      "preview",
      "development",
      "internal-test",
    ]);
    for (const environment of ANALYTICS_ENVIRONMENTS) {
      expect(isAnalyticsEnvironment(environment)).toBe(true);
    }
  });

  it("refuses a lane nobody wrote", () => {
    for (const value of ["staging", "PRODUCTION", "", " preview", null, 1, undefined]) {
      expect(isAnalyticsEnvironment(value)).toBe(false);
    }
  });
});

describe("which lane a build belongs to", () => {
  it("reads the platform's own word for the deployment", () => {
    expect(resolveAnalyticsEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveAnalyticsEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(resolveAnalyticsEnvironment({ VERCEL_ENV: "development" })).toBe("development");
  });

  it("calls a build nobody named a development one", () => {
    expect(resolveAnalyticsEnvironment({})).toBe("development");
    expect(resolveAnalyticsEnvironment({ VERCEL_ENV: "qa" })).toBe("development");
    expect(resolveAnalyticsEnvironment({ VERCEL_ENV: "" })).toBe("development");
  });

  it("never invents a fifth lane from an environment variable", () => {
    expect(resolveAnalyticsEnvironment({ PUBMAX_ANALYTICS_ENVIRONMENT: "staging" }))
      .toBe("development");
    expect(ANALYTICS_ENVIRONMENTS).toContain(
      resolveAnalyticsEnvironment({ VERCEL_ENV: "anything-at-all" }),
    );
  });

  it("keeps our own browser suite out of production, whatever it runs against", () => {
    // The suite's own build sets the variable at BUILD time, so its answer is
    // what gets inlined and the run is internal-test wherever it is driven.
    expect(analyticsBuildEnv({
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
      VERCEL_ENV: "preview",
    })).toEqual({ PUBMAX_ANALYTICS_ENVIRONMENT: "internal-test" });
    expect(resolveAnalyticsEnvironment({
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
      VERCEL_ENV: "preview",
    })).toBe("internal-test");
    expect(resolveAnalyticsEnvironment({
      PUBMAX_ANALYTICS_ENVIRONMENT: "internal-test",
      VERCEL_ENV: "preview",
    })).toBe("internal-test");
  });

  it("refuses to relabel a production runtime from an environment variable", () => {
    // currentAnalyticsAttribution reads the live process.env on the server, so
    // one project variable used to empty every production figure in silence.
    expect(resolveAnalyticsEnvironment({
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
      VERCEL_ENV: "production",
    })).toBe("production");
    // The inlined answer still wins: a build that named itself is not overruled
    // by the platform word it was already resolved from.
    expect(resolveAnalyticsEnvironment({
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
      VERCEL_ENV: "production",
      PUBMAX_ANALYTICS_ENVIRONMENT: "internal-test",
    })).toBe("internal-test");
  });

  it("reads back the answer a build already inlined", () => {
    const built = analyticsBuildEnv({ VERCEL_ENV: "preview" });
    expect(built).toEqual({ PUBMAX_ANALYTICS_ENVIRONMENT: "preview" });
    // The build inlines its answer and the runtime reads it. Resolving twice
    // gives one lane rather than two opinions.
    expect(resolveAnalyticsEnvironment(built)).toBe("preview");
  });
});

describe("which build a figure was measured on", () => {
  it("carries the commit short, from the one rule for what a sha is", () => {
    expect(normalizeAnalyticsRelease(PRODUCTION_SHA)).toBe("5bf044f");
    expect(normalizeAnalyticsRelease(PRODUCTION_SHA.toUpperCase())).toBe("5bf044f");
  });

  it("carries no release rather than a placeholder when the build named no commit", () => {
    for (const value of ["", "local", "main", null, undefined, 5]) {
      expect(normalizeAnalyticsRelease(value)).toBeNull();
    }
    expect(readAnalyticsAttribution({}).release).toBeNull();
    expect(analyticsAttributionProps({ environment: "production", release: null }))
      .not.toHaveProperty("release");
  });
});

describe("the props every event carries", () => {
  it("names the lane, the build and the envelope version", () => {
    expect(analyticsAttributionProps(readAnalyticsAttribution({
      VERCEL_ENV: "production",
      PUBMAX_BUILD_COMMIT_SHA: PRODUCTION_SHA,
    }))).toEqual({
      environment: "production",
      release: "5bf044f",
      schema_version: ANALYTICS_SCHEMA_VERSION,
    });
  });

  it("tells one deployment's journey from another", () => {
    const production = analyticsAttributionProps(readAnalyticsAttribution({
      VERCEL_ENV: "production",
      PUBMAX_BUILD_COMMIT_SHA: PRODUCTION_SHA,
    }));
    const preview = analyticsAttributionProps(readAnalyticsAttribution({
      VERCEL_ENV: "preview",
      PUBMAX_BUILD_COMMIT_SHA: PREVIEW_SHA,
    }));
    const browserTest = analyticsAttributionProps(readAnalyticsAttribution({
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "1",
      VERCEL_ENV: "preview",
      PUBMAX_BUILD_COMMIT_SHA: PREVIEW_SHA,
    }));

    expect(new Set([production.environment, preview.environment, browserTest.environment]).size)
      .toBe(3);
    expect(production.release).not.toBe(preview.release);
  });

  it("holds the envelope version at 2, because 1 is every unattributed row", () => {
    expect(ANALYTICS_SCHEMA_VERSION).toBe(2);
  });
});

describe("history is read as what it is", () => {
  it("reads an unattributed row apart from a production one", () => {
    // A row written before this module carries none of the three names. It is
    // read as unattributed, never as production.
    const historic: Record<string, unknown> = { name: "plan_created", count: 3 };
    for (const name of ATTRIBUTION_PROP_NAMES) {
      expect(historic).not.toHaveProperty(name);
    }
    expect(historic.environment ?? null).toBeNull();
  });

  it("keeps attribution names out of the event registry, so one word has one meaning", () => {
    for (const [event, props] of Object.entries(ANALYTICS_EVENTS)) {
      for (const name of ATTRIBUTION_PROP_NAMES) {
        expect(
          (props as readonly string[]).includes(name),
          `${event} may not declare a prop named ${name}`,
        ).toBe(false);
      }
    }
  });
});

describe("both senders stamp the same two dimensions", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function captureWith(env: Record<string, string>): Promise<Record<string, unknown>> {
    process.env = { ...ORIGINAL_ENV, ...env };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { capturePosthogEvent } = await import("@/lib/posthogServer");
    await capturePosthogEvent({
      event: { name: "plan_created", props: { count: 3 } },
      path: "/plan",
      anonymousId: "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da",
      analyticsConsent: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(defined(fetchMock.mock.calls[0])[1].body)) as {
      properties: Record<string, unknown>;
    };
    return body.properties;
  }

  it("stamps the lane and the build on a named product event", async () => {
    const properties = await captureWith({
      POSTHOG_PROJECT_API_KEY: "phc_server_token",
      PUBMAX_ANALYTICS_ENVIRONMENT: "production",
      PUBMAX_BUILD_COMMIT_SHA: PRODUCTION_SHA,
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "",
    });

    expect(properties.environment).toBe("production");
    expect(properties.release).toBe("5bf044f");
    expect(properties.schema_version).toBe(ANALYTICS_SCHEMA_VERSION);
    // The event's own props survive beside the attribution.
    expect(properties.count).toBe(3);
    expect(properties.path).toBe("/plan");
  });

  it("tells a preview journey from a production one on the same event", async () => {
    const production = await captureWith({
      POSTHOG_PROJECT_API_KEY: "phc_server_token",
      PUBMAX_ANALYTICS_ENVIRONMENT: "production",
      PUBMAX_BUILD_COMMIT_SHA: PRODUCTION_SHA,
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "",
    });
    const preview = await captureWith({
      POSTHOG_PROJECT_API_KEY: "phc_server_token",
      PUBMAX_ANALYTICS_ENVIRONMENT: "preview",
      PUBMAX_BUILD_COMMIT_SHA: PREVIEW_SHA,
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "",
    });

    expect(production.environment).toBe("production");
    expect(preview.environment).toBe("preview");
    expect(production.release).not.toBe(preview.release);
  });

  it("never lets a registry prop overwrite the lane an event came from", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      POSTHOG_PROJECT_API_KEY: "phc_server_token",
      PUBMAX_ANALYTICS_ENVIRONMENT: "production",
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "",
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { capturePosthogEvent } = await import("@/lib/posthogServer");
    await capturePosthogEvent({
      // sanitizeEvent can never build this shape. The spread order is what
      // makes it harmless if a future registry ever could.
      event: {
        name: "plan_created",
        props: { environment: "development", schema_version: 1 } as never,
      },
      path: "/plan",
      anonymousId: "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da",
      analyticsConsent: true,
    });
    const body = JSON.parse(String(defined(fetchMock.mock.calls[0])[1].body)) as {
      properties: Record<string, unknown>;
    };
    expect(body.properties.environment).toBe("production");
    expect(body.properties.schema_version).toBe(ANALYTICS_SCHEMA_VERSION);
  });

  it("stamps the same two dimensions on every browser SDK event", async () => {
    process.env = {
      ...ORIGINAL_ENV,
      PUBMAX_ANALYTICS_ENVIRONMENT: "preview",
      PUBMAX_BUILD_COMMIT_SHA: PREVIEW_SHA,
      NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT: "",
    };
    const { sanitizePosthogEvent } = await import("@/lib/posthogClient");
    const anonymousId = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";

    const pageview = sanitizePosthogEvent({
      uuid: "018f47a2-8e71-7a7a-9f18-8b953d45b2da",
      event: "$pageview",
      properties: {
        distinct_id: anonymousId,
        $device_id: anonymousId,
        $pubmaxx_anonymous_id: anonymousId,
        $pathname: "/map",
      },
    } as never);
    const exception = sanitizePosthogEvent({
      uuid: "018f47a2-8e71-7a7a-9f18-8b953d45b2da",
      event: "$exception",
      properties: {
        distinct_id: anonymousId,
        $pathname: "/map",
        $exception_list: [{ type: "TypeError", value: "person@example.com" }],
      },
    } as never);

    for (const sanitized of [pageview, exception]) {
      expect(sanitized?.properties.environment).toBe("preview");
      expect(sanitized?.properties.release).toBe("1d716d9");
      expect(sanitized?.properties.schema_version).toBe(ANALYTICS_SCHEMA_VERSION);
    }
  });
});
