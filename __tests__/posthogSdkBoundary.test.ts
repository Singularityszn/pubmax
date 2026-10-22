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
    // The unload beacon posts the batch as base64 form data.
    const data = url.includes("compression=base64") ? new URLSearchParams(body).get("data") : null;
    if (data) decoded = Buffer.from(data, "base64").toString("utf8");
    return `${url} ${decoded}`;
  });
}

function settle(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let posthog: (typeof import("posthog-js"))["default"];
let capturedBeforeUnload = -1;

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
  // The lazy flag, recorder, heatmap and survey loads that fire after init
  // when enabled all land inside this window. Capture is batched, so the
  // pageview is still queued here.
  await settle(500);
  capturedBeforeUnload = decodedRequests().filter((request) => request.includes("$pageview")).length;
  window.history.replaceState(null, "", "/privacy");
  capturePosthogPageview("/privacy", ANON);
  await settle(10);
  // Internal navigation carries the previous visit on the next pageview.
  // Leaving the document flushes the final pageleave in the same beacon.
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("beforeunload"));
  await settle(100);
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

  it("keeps the proxy marker PostHog's reverse-proxy health check reads", () => {
    // before_send used to strip $lib_custom_api_host, so PostHog reported "no
    // reverse proxy detected" although every event already went via /ingest.
    const pageview = decodedRequests().find((request) => request.includes("$pageview"));
    expect(pageview).toContain('"$lib_custom_api_host":"/ingest"');
    expect(pageview).toContain('"$lib":"web"');
  });

  it("batches capture: the pageview waits for the queue flush, not one request per event", () => {
    expect(capturedBeforeUnload).toBe(0);
    const captures = sent.filter(({ url }) => /\/ingest\/(e|i\/v0\/e|batch)\//.test(url));
    expect(captures.length).toBeGreaterThan(0);
    expect(captures.every(({ url }) => url.startsWith("/ingest/"))).toBe(true);
  });

  it("sends the final pageleave with duration and scroll depth through ingest", () => {
    const exits = decodedRequests().filter((request) => request.includes('"event":"$pageleave"'));
    expect(exits).toHaveLength(1);
    expect(exits[0]).toContain('"$prev_pageview_pathname":"/privacy"');
    expect(exits[0]).toContain('"$prev_pageview_duration":');
    expect(exits[0]).toContain('"$prev_pageview_max_content_percentage":');
  });

  it("keeps the previous visit measurements on internal navigation", () => {
    const request = decodedRequests().find((entry) => entry.includes('"$prev_pageview_pathname":"/map"'));
    expect(request).toContain('"$prev_pageview_id":');
    expect(request).toContain('"$prev_pageview_duration":');
    expect(request).toContain('"$prev_pageview_max_content_percentage":');
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

describe("consent epochs at the real SDK boundary", () => {
  it.each(["queued", "direct"])("isolates the first %s view and its exit after renewed consent", async (mode) => {
    const { capturePosthogPageview, syncPosthogConsent } = await import("@/lib/posthogClient");
    const events = () => decodedRequests().flatMap((request) => {
      const body = request.slice(request.indexOf(" ") + 1);
      if (!body) return [];
      type EmittedEvent = { event: string; properties: Record<string, unknown> };
      const parsed = JSON.parse(body) as EmittedEvent | EmittedEvent[] | { batch: EmittedEvent[] };
      return Array.isArray(parsed) ? parsed : "batch" in parsed ? parsed.batch : [parsed];
    });
    const firstId = mode === "queued" ? "anon_1111111111111111" : "anon_3333333333333333";
    const renewedId = mode === "queued" ? "anon_2222222222222222" : "anon_4444444444444444";
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(start);
      posthog.set_config({ request_batching: false });
      syncPosthogConsent(false);
      window.localStorage.setItem("pubmaxx:analytics-id:v1", firstId);
      window.history.replaceState(null, "", "/privacy");
      syncPosthogConsent(true);
      capturePosthogPageview("/privacy", firstId);
      await vi.waitFor(() => expect(events()).toEqual(expect.arrayContaining([
        expect.objectContaining({ properties: expect.objectContaining({ distinct_id: firstId }) }),
      ])));
      const oldView = events().find(({ event, properties }) => event === "$pageview" && properties.distinct_id === firstId)!;

      syncPosthogConsent(false);
      window.localStorage.removeItem("pubmaxx:analytics-id:v1");
      const countAtWithdrawal = sent.length;
      vi.setSystemTime(start + 120_000);
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("pagehide"));
      await settle(10);
      expect(sent).toHaveLength(countAtWithdrawal);

      window.localStorage.setItem("pubmaxx:analytics-id:v1", renewedId);
      syncPosthogConsent(true);
      if (mode === "direct") await settle(10);
      capturePosthogPageview("/privacy", renewedId);
      await vi.waitFor(() => expect(events().some(({ properties }) => properties.distinct_id === renewedId)).toBe(true));
      const renewedView = events().find(({ event, properties }) => event === "$pageview" && properties.distinct_id === renewedId)!;
      expect(renewedView.properties.$pageview_id).toEqual(expect.any(String));
      expect(renewedView.properties.$pageview_id).not.toBe(oldView.properties.$pageview_id);

      vi.setSystemTime(start + 123_000);
      window.dispatchEvent(new Event("pagehide"));
      await settle(10);
      const exit = events().find(({ event, properties }) => event === "$pageleave" && properties.distinct_id === renewedId)!;
      expect(exit.properties).toMatchObject({
        $prev_pageview_id: renewedView.properties.$pageview_id,
        $prev_pageview_duration: expect.any(Number),
        $prev_pageview_max_content_percentage: expect.any(Number),
      });
      expect(exit.properties.$prev_pageview_duration).toBeGreaterThan(2);
      expect(exit.properties.$prev_pageview_duration).toBeLessThanOrEqual(3);
      expect(exit.properties.$prev_pageview_id).not.toBe(oldView.properties.$pageview_id);

      window.history.replaceState(null, "", "/terms");
      capturePosthogPageview("/terms", renewedId);
      await settle(10);
      const nextView = events().find(({ event, properties }) => event === "$pageview" && properties.distinct_id === renewedId && properties.$pathname === "/terms")!;
      expect(nextView.properties).toMatchObject({
        $prev_pageview_id: renewedView.properties.$pageview_id,
        $prev_pageview_duration: exit.properties.$prev_pageview_duration,
      });
      expect(renewedView.properties).not.toHaveProperty("$prev_pageview_id");
      expect(Object.keys(renewedView.properties).filter((key) => key.startsWith("$prev_pageview_"))).toEqual([]);
    } finally {
      syncPosthogConsent(false);
      vi.useRealTimers();
    }
  });
});
