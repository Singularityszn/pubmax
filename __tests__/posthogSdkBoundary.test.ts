// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Drives the real posthog-js with the shipped browser config and a stubbed
 * fetch, so the proof is what leaves the browser, not what the config says.
 * The config-literal test in posthogClient.test.ts passed while /flags sent
 * the account id and the raw landing URL, and while replay, heatmaps and
 * identify were dropped by before_send (week security review M3, M4, T9).
 *
 * posthog-js is a process singleton that vi.resetModules does not reload, so
 * the file boots it ONCE and each case reads the same session.
 */

const TOKEN = "phc_boundary_test";
const ANON = "anon_0123456789abcdef";
const ACCOUNT_ID = "018f47a2-8e71-7a7a-9f18-8b953d45b2da";
const LANDING = "/map?authAttempt=abc123&next=%2Fyou#access_token=SECRETTOKEN";
// What the ingest host would answer if a project switched every feature on.
// The browser config alone must keep them off.
const PERMISSIVE_REMOTE_CONFIG = {
  status: 1,
  featureFlags: {},
  flags: {},
  sessionRecording: { endpoint: "/s/" },
  heatmaps: true,
  surveys: true,
  autocaptureExceptions: true,
};

type SentRequest = { url: string; body: string };

const sent: SentRequest[] = [];

async function bodyText(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof Blob) return body.text();
  if (body instanceof URLSearchParams) return body.toString();
  return body == null ? "" : String(body);
}

function decodedRequests(): string[] {
  return sent.map(({ url, body }) => {
    let decoded = body;
    try {
      decoded = decodeURIComponent(body);
    } catch {
      // Keep the raw body when it is not URI encoded.
    }
    return `${url} ${decoded}`;
  });
}

function settle(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let posthog: (typeof import("posthog-js"))["default"];

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", TOKEN);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: input.toString(), body: await bodyText(init?.body) });
    return new Response(JSON.stringify(PERMISSIVE_REMOTE_CONFIG), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
  Object.defineProperty(window.navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, body?: BodyInit | null) => {
      void bodyText(body).then((text) => sent.push({ url, body: text }));
      return true;
    },
  });

  // The SDK reads remote config from the config.js script, which jsdom never
  // runs. Seed the global that script fills, so the server says "all on".
  Object.assign(window, {
    _POSTHOG_REMOTE_CONFIG: { [TOKEN]: { config: PERMISSIVE_REMOTE_CONFIG, siteApps: [] } },
  });
  window.history.replaceState(null, "", LANDING);
  window.localStorage.setItem("pubmaxx:analytics-id:v1", ANON);
  // The release before this fix called identify(<account id>) after sign-in,
  // and posthog-js persisted that person in its cookie and localStorage.
  const identified = JSON.stringify({
    distinct_id: ACCOUNT_ID,
    $device_id: ANON,
    $user_state: "identified",
  });
  window.localStorage.setItem(`ph_${TOKEN}_posthog`, identified);
  document.cookie = `ph_${TOKEN}_posthog=${encodeURIComponent(identified)}; path=/`;

  const { posthogBrowserConfig, syncPosthogConsent } = await import("@/lib/posthogClient");
  // jsdom's user agent trips the SDK bot filter; production keeps that filter.
  Object.assign(posthogBrowserConfig, {
    opt_out_useragent_filter: true,
    disable_compression: true,
  });
  syncPosthogConsent(true);
  posthog = (await import("posthog-js")).default;
  await vi.waitFor(() => expect(posthog.__loaded).toBe(true));

  const { capturePosthogPageview } = await import("@/lib/posthogClient");
  capturePosthogPageview("/map", ANON);
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 5 }));
  // The pageview send, and the lazy flag, recorder, heatmap and survey loads
  // that fire after init when enabled, all land inside this window.
  await settle(500);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PostHog SDK boundary (real posthog-js, stubbed fetch)", () => {
  it("never calls /flags", () => {
    expect(decodedRequests().filter((request) => /\/flags|\/decide/.test(request))).toEqual([]);
  });

  it("never sends the account id, the landing query or the auth fragment", () => {
    expect(sent.length).toBeGreaterThan(0);
    for (const request of decodedRequests()) {
      expect(request).not.toContain(ACCOUNT_ID);
      expect(request).not.toContain("SECRETTOKEN");
      expect(request).not.toContain("authAttempt");
    }
  });

  it("heals a browser a previous release identified, and its pageview still sends", () => {
    expect(posthog.get_distinct_id()).toBe(ANON);
    const pageviews = decodedRequests().filter((request) => request.includes("$pageview"));
    expect(pageviews).toHaveLength(1);
    expect(pageviews[0]).toContain(`"distinct_id":"${ANON}"`);
  });

  it("loads no recorder, heatmap or survey code and sends no $snapshot or $$heatmap", () => {
    const featureScripts = Array.from(document.querySelectorAll("script"))
      .map((script) => script.src)
      .filter((src) => /recorder|surveys|heatmap/.test(src));
    expect(featureScripts).toEqual([]);
    expect(posthog.sessionRecordingStarted()).toBe(false);
    expect(posthog.heatmaps?.isEnabled).toBe(false);
    for (const request of decodedRequests()) {
      expect(request).not.toContain("$snapshot");
      expect(request).not.toContain("$$heatmap");
    }
  });
});
