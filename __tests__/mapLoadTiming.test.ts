// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "posthog-js";

import {
  MAP_LOAD_TIMEOUT_MS,
  MAP_LOAD_TIMING_EVENT,
  mapLoadDeviceClass,
  sanitizeMapLoadTimingProps,
  type MapLoadTimingProps,
} from "@/lib/mapLoadTimingEvent";

const posthogState = vi.hoisted(() => ({
  captures: [] as Array<[string, Record<string, unknown>, unknown]>,
  optedOut: true,
}));

vi.mock("posthog-js", () => ({
  default: {
    capture: (name: string, properties: Record<string, unknown>, options?: unknown) => {
      if (!posthogState.optedOut) posthogState.captures.push([name, properties, options]);
    },
    get_distinct_id: () => "anon_0123456789abcdef",
    init: () => undefined,
    opt_in_capturing: () => { posthogState.optedOut = false; },
    opt_out_capturing: () => { posthogState.optedOut = true; },
    reset: () => undefined,
  },
}));

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const ANON = "anon_018f47a2-8e71-7a7a-9f18-8b953d45b2da";
const UUID = "018f47a2-8e71-7a7a-9f18-8b953d45b2da";

const PAINTED: MapLoadTimingProps = {
  outcome: "painted",
  surface: "/map",
  landed_on_map: true,
  mount_ms: 410,
  elapsed_ms: 2_350,
  nav_type: "navigate",
  sw_controlled: false,
  returning_visit: false,
  hidden_before_pins: false,
  device_class: "phone",
  mobile: true,
  viewport_width: 390,
  viewport_height: 844,
  effective_type: "4g",
  venue_count: 812,
  map_constructed_ms: 900,
  scene_built_ms: 1_700,
  first_pins_ms: 1_200,
  pins_visible_ms: 2_340,
  save_data: false,
  device_memory: 4,
  hardware_concurrency: 8,
};

function grantConsent(): void {
  window.localStorage.setItem(CONSENT_KEY, "granted");
}

beforeEach(() => {
  performance.clearMarks();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, "doNotTrack", { configurable: true, value: "0" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllEnvs();
  posthogState.captures = [];
  posthogState.optedOut = true;
});

describe("map_load_timing event shape", () => {
  it("round-trips a painted visit unchanged", () => {
    expect(sanitizeMapLoadTimingProps(PAINTED)).toEqual(PAINTED);
  });

  it("drops anything outside the closed shape, so no free text or URL can leave", () => {
    const sanitized = sanitizeMapLoadTimingProps({
      ...PAINTED,
      email: "person@example.com",
      url: "https://pubmaxxing.com/map?handle=secret",
      venue_name: "The Secret Arms",
      device_memory: 3.7,
      hardware_concurrency: 0,
    });
    expect(sanitized).not.toHaveProperty("email");
    expect(sanitized).not.toHaveProperty("url");
    expect(sanitized).not.toHaveProperty("venue_name");
    expect(sanitized).not.toHaveProperty("device_memory");
    expect(sanitized).not.toHaveProperty("hardware_concurrency");
    expect(JSON.stringify(sanitized)).not.toMatch(/secret|example\.com/i);
  });

  it("rejects an unknown enum, a raw path surface or an impossible clock", () => {
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, outcome: "fast" })).toBeNull();
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, nav_type: "typed" })).toBeNull();
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, effective_type: "5g" })).toBeNull();
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, surface: "/u/someone?x=1" })).toBeNull();
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, elapsed_ms: -1 })).toBeNull();
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, venue_count: Number.NaN })).toBeNull();
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, pins_visible_ms: 90_000_000 })).toBeNull();
  });

  it("keeps a visit to a map opened late in a long-lived tab", () => {
    const late = {
      ...PAINTED,
      mount_ms: 3_600_000,
      map_constructed_ms: 3_600_400,
      scene_built_ms: 3_601_100,
      first_pins_ms: 3_600_900,
      pins_visible_ms: 3_601_800,
      elapsed_ms: 3_601_810,
    };
    expect(sanitizeMapLoadTimingProps(late)).toEqual(late);
  });

  it("never lets a tail visit claim a paint time, and a painted one must carry it", () => {
    expect(sanitizeMapLoadTimingProps({ ...PAINTED, outcome: "timeout" }))
      .not.toHaveProperty("pins_visible_ms");
    const withoutPaint: Partial<MapLoadTimingProps> = { ...PAINTED };
    delete withoutPaint.pins_visible_ms;
    expect(sanitizeMapLoadTimingProps(withoutPaint)).toBeNull();
  });

  it("classes the device by viewport width", () => {
    expect(mapLoadDeviceClass(390)).toBe("phone");
    expect(mapLoadDeviceClass(820)).toBe("tablet");
    expect(mapLoadDeviceClass(1440)).toBe("desktop");
  });
});

describe("map_load_timing at the browser SDK boundary", () => {
  it("passes before_send with the closed shape and a query-free URL", async () => {
    const { sanitizePosthogEvent } = await import("@/lib/posthogClient");
    const event: CaptureResult = {
      uuid: UUID,
      event: MAP_LOAD_TIMING_EVENT,
      properties: {
        ...PAINTED,
        token: "phc_public",
        distinct_id: ANON,
        $device_id: ANON,
        $current_url: "https://pubmaxxing.com/map?handle=secret",
        $set: { email: "person@example.com" },
        free_text: "secret",
      },
    };
    const sanitized = sanitizePosthogEvent(event);
    expect(sanitized?.event).toBe(MAP_LOAD_TIMING_EVENT);
    expect(sanitized?.properties).toMatchObject(PAINTED);
    expect(sanitized?.properties.$pathname).toBe("/map");
    expect(sanitized?.properties.$current_url).toBe("https://pubmaxxing.com/map");
    expect(JSON.stringify(sanitized)).not.toMatch(/secret|example\.com/);
  });

  it("keeps no URL for a surface the pageview list does not name", async () => {
    const { sanitizePosthogEvent } = await import("@/lib/posthogClient");
    const sanitized = sanitizePosthogEvent({
      uuid: UUID,
      event: MAP_LOAD_TIMING_EVENT,
      properties: {
        ...PAINTED,
        surface: "other",
        distinct_id: ANON,
        $pathname: "/u/private-handle",
        $current_url: "https://pubmaxxing.com/u/private-handle",
      },
    });
    expect(sanitized?.properties.surface).toBe("other");
    expect(sanitized?.properties).not.toHaveProperty("$current_url");
    expect(sanitized?.properties).not.toHaveProperty("$pathname");
  });

  it("drops the event without a consented anonymous device id or with a bad shape", async () => {
    const { sanitizePosthogEvent } = await import("@/lib/posthogClient");
    const base: CaptureResult = {
      uuid: UUID,
      event: MAP_LOAD_TIMING_EVENT,
      properties: { ...PAINTED, distinct_id: ANON },
    };
    expect(sanitizePosthogEvent({
      ...base,
      properties: { ...PAINTED, distinct_id: UUID },
    })).toBeNull();
    expect(sanitizePosthogEvent({
      ...base,
      properties: { ...PAINTED, distinct_id: ANON, outcome: "fast" },
    })).toBeNull();
  });

  it("sends nothing to the SDK without consent, and one event once consent loads it", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    const { capturePosthogMapLoadTiming, syncPosthogConsent } = await import("@/lib/posthogClient");

    capturePosthogMapLoadTiming(PAINTED);
    syncPosthogConsent(true);
    await vi.waitFor(() => expect(posthogState.optedOut).toBe(false));
    expect(posthogState.captures).toEqual([]);

    syncPosthogConsent(false);
    syncPosthogConsent(true);
    capturePosthogMapLoadTiming(PAINTED);
    await vi.waitFor(() => expect(posthogState.captures).toHaveLength(1));
    expect(posthogState.captures[0]?.[0]).toBe(MAP_LOAD_TIMING_EVENT);
    expect(posthogState.captures[0]?.[1]).toEqual(PAINTED);

    capturePosthogMapLoadTiming({ ...PAINTED, outcome: "abandoned" }, { beacon: true });
    expect(posthogState.captures[1]?.[2]).toEqual({ transport: "sendBeacon" });
  });
});

describe("map_load_timing exits before the SDK has loaded", () => {
  const OUTBOX_KEY = "pubmaxx:map-load-timing-outbox:v1";
  const ABANDONED: MapLoadTimingProps = (() => {
    const props: MapLoadTimingProps = { ...PAINTED, outcome: "abandoned" };
    delete props.pins_visible_ms;
    return props;
  })();

  /** A page that has consent but whose SDK never loaded before it unloaded. */
  async function exitBeforeSdk(): Promise<void> {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
    const { capturePosthogMapLoadTiming, syncPosthogConsent } = await import("@/lib/posthogClient");
    syncPosthogConsent(true);
    capturePosthogMapLoadTiming(ABANDONED, { beacon: true });
    vi.resetModules();
  }

  it("keeps the exit and sends it once, under its own time, from the next consented page", async () => {
    const before = Date.now();
    await exitBeforeSdk();
    expect(window.localStorage.getItem(OUTBOX_KEY)).not.toBeNull();

    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    const { syncPosthogConsent } = await import("@/lib/posthogClient");
    syncPosthogConsent(true);
    await vi.waitFor(() => expect(posthogState.captures).toHaveLength(1));

    const [name, props, options] = posthogState.captures[0] ?? [];
    expect(name).toBe(MAP_LOAD_TIMING_EVENT);
    expect(props).toEqual(ABANDONED);
    const timestamp = (options as { timestamp?: Date } | undefined)?.timestamp;
    expect(timestamp?.getTime()).toBeGreaterThanOrEqual(before);
    expect(timestamp?.getTime()).toBeLessThanOrEqual(Date.now());
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it("forgets the stored exit when consent is withdrawn", async () => {
    await exitBeforeSdk();
    const { syncPosthogConsent } = await import("@/lib/posthogClient");
    syncPosthogConsent(false);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });

  it("drops a stored exit that is over a day old or outside the closed shape", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test");
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({
      timing: ABANDONED,
      at: Date.now() - 90_000_000,
    }));
    const first = await import("@/lib/posthogClient");
    first.syncPosthogConsent(true);
    await vi.waitFor(() => expect(posthogState.optedOut).toBe(false));
    expect(posthogState.captures).toEqual([]);
    expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();

    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({
      timing: { ...ABANDONED, email: "person@example.com", outcome: "fast" },
      at: Date.now(),
    }));
    first.syncPosthogConsent(false);
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({
      timing: { ...ABANDONED, outcome: "fast" },
      at: Date.now(),
    }));
    first.syncPosthogConsent(true);
    await vi.waitFor(() => expect(posthogState.optedOut).toBe(false));
    expect(posthogState.captures).toEqual([]);
  });
});

describe("startMapLoadTiming", () => {
  async function start(overrides: Partial<Parameters<
    typeof import("@/lib/mapLoadTiming").startMapLoadTiming
  >[0]> = {}) {
    const { startMapLoadTiming } = await import("@/lib/mapLoadTiming");
    const { markPubmaxTiming } = await import("@/lib/performanceMarks");
    const capture = vi.fn();
    const stop = startMapLoadTiming({
      mountMs: performance.now(),
      venueCount: () => 812,
      capture,
      ...overrides,
    });
    return { capture, stop, markPubmaxTiming };
  }

  it("sends one painted event carrying this visit's milestones", async () => {
    grantConsent();
    performance.mark("pubmax:first-pins"); // a previous visit in this document
    const { capture, stop, markPubmaxTiming } = await start();

    markPubmaxTiming("pubmax:map-constructed");
    markPubmaxTiming("pubmax:map-scene-built");
    markPubmaxTiming("pubmax:first-pins");
    markPubmaxTiming("pubmax:pins-visible");
    markPubmaxTiming("pubmax:pins-visible");
    stop();

    expect(capture).toHaveBeenCalledTimes(1);
    const [props, options] = capture.mock.calls[0] as [MapLoadTimingProps, unknown];
    expect(options).toEqual({});
    expect(props.outcome).toBe("painted");
    expect(props.venue_count).toBe(812);
    expect(props.surface).toBe("/");
    for (const key of ["map_constructed_ms", "scene_built_ms", "first_pins_ms", "pins_visible_ms"] as const) {
      expect(props[key]).toBeGreaterThanOrEqual(props.mount_ms);
    }
    expect(sanitizeMapLoadTimingProps(props)).toEqual(props);
  });

  it("records the tail as a timeout when pins never paint within 30 s", async () => {
    grantConsent();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { capture, stop, markPubmaxTiming } = await start();

    vi.advanceTimersByTime(MAP_LOAD_TIMEOUT_MS - 50);
    expect(capture).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    markPubmaxTiming("pubmax:pins-visible");
    stop();

    expect(capture).toHaveBeenCalledTimes(1);
    const [props] = capture.mock.calls[0] as [MapLoadTimingProps];
    expect(props.outcome).toBe("timeout");
    expect(props).not.toHaveProperty("pins_visible_ms");
    expect(sanitizeMapLoadTimingProps(props)).toEqual(props);
  });

  it("records an exit before the pins as abandoned, by beacon on pagehide", async () => {
    grantConsent();
    const left = await start();
    left.stop();
    expect(left.capture.mock.calls[0]?.[0]).toMatchObject({ outcome: "abandoned" });

    const hidden = await start();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    hidden.stop();
    expect(hidden.capture).toHaveBeenCalledTimes(1);
    expect(hidden.capture.mock.calls[0]).toEqual([
      expect.objectContaining({ outcome: "abandoned" }),
      { beacon: true },
    ]);
  });

  it("sends nothing without analytics consent, after a denial, or under Do-Not-Track", async () => {
    const noAnswer = await start();
    noAnswer.markPubmaxTiming("pubmax:pins-visible");
    expect(noAnswer.capture).not.toHaveBeenCalled();

    window.localStorage.setItem(CONSENT_KEY, "denied");
    const denied = await start();
    denied.stop();
    expect(denied.capture).not.toHaveBeenCalled();

    grantConsent();
    Object.defineProperty(window.navigator, "doNotTrack", { configurable: true, value: "1" });
    const dnt = await start();
    dnt.markPubmaxTiming("pubmax:pins-visible");
    expect(dnt.capture).not.toHaveBeenCalled();
  });
});
