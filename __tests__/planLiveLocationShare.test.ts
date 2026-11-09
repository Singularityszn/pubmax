import { afterEach, describe, expect, it, vi } from "vitest";

import { liveShareSnapshot, startLiveLocationShare, stopLiveLocationShare } from "@/lib/planLiveLocationShare";

const SEAT = { planId: "11111111-1111-4111-8111-111111111111", via: "plan" as const };

function fakeGeolocation() {
  let onFix: PositionCallback = () => {};
  let onError: PositionErrorCallback | null | undefined = null;
  const geolocation = {
    watchPosition: vi.fn((success: PositionCallback, error?: PositionErrorCallback | null) => {
      onFix = success;
      onError = error;
      return 7;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  };
  return {
    geolocation: geolocation as unknown as Geolocation,
    spy: geolocation,
    fix(latitude: number, longitude: number) {
      onFix({ coords: { latitude, longitude, accuracy: 9.6 }, timestamp: Date.now() } as GeolocationPosition);
    },
    fail(code: number) {
      onError?.({ code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    },
  };
}

/** Each call resolves the next awaited `call()` with what the route was sent. */
function fakeRoute(status = 200) {
  const calls: { method: string; body?: unknown }[] = [];
  let notify: (() => void) | null = null;
  const request = vi.fn(async (_seat: unknown, method: string, body?: unknown) => {
    calls.push({ method, body });
    notify?.();
    return new Response("{}", { status });
  });
  return {
    request,
    calls,
    next: () => new Promise<void>((resolve) => { notify = resolve; }),
  };
}

afterEach(async () => {
  await stopLiveLocationShare(SEAT, { request: async () => new Response("{}") });
  vi.useRealTimers();
});

describe("sharing a live location from the phone", () => {
  it("asks the browser only when sharing starts, then sends the fix", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    expect(geo.spy.watchPosition).not.toHaveBeenCalled();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
    expect(liveShareSnapshot()).toEqual({ planId: SEAT.planId, status: "asking" });
    const sent = route.next();
    geo.fix(51.5138, -0.1318);
    await sent;
    expect(route.calls).toEqual([{ method: "PUT", body: { latitude: 51.5138, longitude: -0.1318, accuracyM: 10 } }]);
    await vi.waitFor(() => expect(liveShareSnapshot().status).toBe("on"));
  });

  it("handles a refused permission calmly and sends nothing", () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    geo.fail(1);
    expect(liveShareSnapshot()).toEqual({ planId: SEAT.planId, status: "denied" });
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(route.request).not.toHaveBeenCalled();
  });

  it("removes the dot when permission is withdrawn mid-night", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    let seen = route.next();
    geo.fix(51.5, -0.13);
    await seen;
    await vi.waitFor(() => expect(liveShareSnapshot().status).toBe("on"));
    seen = route.next();
    geo.fail(1);
    await seen;
    expect(route.calls.at(-1)).toEqual({ method: "DELETE", body: undefined });
    expect(liveShareSnapshot().status).toBe("denied");
  });

  it("keeps watching through a lost signal", () => {
    const geo = fakeGeolocation();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: fakeRoute().request });
    geo.fail(3);
    expect(liveShareSnapshot().status).toBe("no-signal");
    expect(geo.spy.clearWatch).not.toHaveBeenCalled();
  });

  it("does not resend a fix that has hardly moved", async () => {
    let now = 1_000_000;
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request, now: () => now });
    const first = route.next();
    geo.fix(51.5, -0.13);
    await first;
    await vi.waitFor(() => expect(liveShareSnapshot().status).toBe("on"));
    now += 25_000;
    geo.fix(51.50001, -0.13);
    expect(route.calls).toHaveLength(1);
    const moved = route.next();
    geo.fix(51.501, -0.13);
    await moved;
    expect(route.calls).toHaveLength(2);
  });

  it("stops the watch and deletes the position when the person stops", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    await stopLiveLocationShare(SEAT, { request: route.request });
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(route.calls).toEqual([{ method: "DELETE", body: undefined }]);
    expect(liveShareSnapshot().status).toBe("off");
  });

  it("switches off when the server says the night is over", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute(409);
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    const sent = route.next();
    geo.fix(51.5, -0.13);
    await sent;
    await vi.waitFor(() => expect(liveShareSnapshot().status).toBe("ended"));
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
  });

  it("says when the phone has no location service", () => {
    startLiveLocationShare(SEAT, { geolocation: null, request: fakeRoute().request });
    expect(liveShareSnapshot().status).toBe("unsupported");
  });
});
