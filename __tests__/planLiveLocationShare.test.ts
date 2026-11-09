import { afterEach, describe, expect, it, vi } from "vitest";

import { liveShareSnapshot, startLiveLocationShare, stopLiveLocationShare } from "@/lib/planLiveLocationShare";
import { setProviderIdentity } from "@/lib/authProviderRevision";

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
    expect(liveShareSnapshot(SEAT.planId)).toEqual({ planId: SEAT.planId, status: "asking" });
    const sent = route.next();
    geo.fix(51.5138, -0.1318);
    await sent;
    expect(route.calls).toEqual([{ method: "PUT", body: { latitude: 51.5138, longitude: -0.1318, accuracyM: 10 } }]);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
  });

  it("deletes a stored spot on permission refusal before any acknowledged upload", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    geo.fail(1);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("stopping");
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("denied"));
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(route.calls).toEqual([{ method: "DELETE", body: undefined }]);
  });

  it("deletes after a committed upload loses its response and permission is refused", async () => {
    const geo = fakeGeolocation();
    let sharing = false;
    const request = vi.fn(async (_seat: unknown, method: string) => {
      if (method === "PUT") {
        sharing = true;
        throw new Error("response lost");
      }
      if (method === "DELETE") sharing = false;
      return new Response("{}");
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("no-signal"));
    expect(sharing).toBe(true);
    geo.fail(1);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("denied"));
    expect(sharing).toBe(false);
  });

  it("removes the dot when permission is withdrawn mid-night", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    let seen = route.next();
    geo.fix(51.5, -0.13);
    await seen;
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    seen = route.next();
    geo.fail(1);
    await seen;
    expect(route.calls.at(-1)).toEqual({ method: "DELETE", body: undefined });
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("denied"));
  });

  it.each(["offline", "503"])("keeps deletion unconfirmed after permission withdrawal when %s", async (failure) => {
    const geo = fakeGeolocation();
    let sharing = false;
    let failDelete = true;
    const request = vi.fn(async (_seat: unknown, method: string) => {
      if (method === "PUT") sharing = true;
      if (method === "DELETE") {
        if (failDelete) {
          if (failure === "offline") throw new Error("offline");
          return new Response("{}", { status: 503 });
        }
        sharing = false;
      }
      return new Response("{}");
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    geo.fail(1);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("failed"));
    expect(sharing).toBe(true);
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    failDelete = false;
    await stopLiveLocationShare(SEAT, { request });
    expect(sharing).toBe(false);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
  });

  it("refuses another Plan synchronously without stopping or later starting it", async () => {
    const otherSeat = { ...SEAT, planId: "other-plan" };
    const geo = fakeGeolocation();
    const other = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    geo.fix(51.5, -0.13);
    const refused = startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: route.request });
    expect(liveShareSnapshot(otherSeat.planId).status).toBe("busy");
    expect(liveShareSnapshot(SEAT.planId).status).toBe("asking");
    expect(geo.spy.clearWatch).not.toHaveBeenCalled();
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    expect(liveShareSnapshot(otherSeat.planId).status).toBe("busy");
    await stopLiveLocationShare(otherSeat, { request: fakeRoute(503).request });
    expect(liveShareSnapshot(otherSeat.planId).status).toBe("failed");
    expect(liveShareSnapshot(SEAT.planId).status).toBe("on");
    await stopLiveLocationShare(otherSeat, { request: route.request });
    expect(liveShareSnapshot(SEAT.planId).status).toBe("on");
    startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: route.request });
    expect(liveShareSnapshot(otherSeat.planId).status).toBe("busy");
    await stopLiveLocationShare(SEAT);
    await refused;
    expect(liveShareSnapshot(otherSeat.planId).status).toBe("off");
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: route.request });
    expect(other.spy.watchPosition).toHaveBeenCalledTimes(1);
    await stopLiveLocationShare(otherSeat);
  });

  it.each(["offline", "503"])("blocks both Plans until an unconfirmed stop succeeds after %s", async (failure) => {
    const otherSeat = { ...SEAT, planId: "other-plan" };
    const geo = fakeGeolocation();
    const other = fakeGeolocation();
    const route = fakeRoute();
    let failDelete = true;
    const request = vi.fn(async () => {
      if (failDelete) {
        if (failure === "offline") throw new Error("offline");
        return new Response("{}", { status: 503 });
      }
      return new Response("{}");
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    await stopLiveLocationShare(SEAT).catch(() => undefined);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    startLiveLocationShare(SEAT, { geolocation: other.geolocation, request: route.request });
    startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: route.request });
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    expect(liveShareSnapshot(otherSeat.planId).status).toBe("busy");
    failDelete = false;
    await stopLiveLocationShare(SEAT, { request });
    expect(request).toHaveBeenCalledTimes(2);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: route.request });
    expect(other.spy.watchPosition).toHaveBeenCalledTimes(1);
    await stopLiveLocationShare(otherSeat);
  });

  it("keeps watching through a lost signal", () => {
    const geo = fakeGeolocation();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: fakeRoute().request });
    geo.fail(3);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("no-signal");
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
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
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
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
  });

  it("switches off when the server says the night is over", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute(409);
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    const sent = route.next();
    geo.fix(51.5, -0.13);
    await sent;
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("ended"));
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
  });

  it.each(["stop", "denied"])("deletes after the first pending PUT on %s", async (reason) => {
    const geo = fakeGeolocation();
    let finish!: (response: Response) => void;
    const committed: string[] = [];
    let deleted!: () => void;
    const deletion = new Promise<void>((resolve) => { deleted = resolve; });
    let finishDelete!: () => void;
    const request = vi.fn(async (_seat: unknown, method: string) => {
      if (method === "PUT") await new Promise<Response>((resolve) => { finish = resolve; });
      if (method === "DELETE") {
        deleted();
        await new Promise<void>((resolve) => { finishDelete = resolve; });
      }
      committed.push(method);
      return new Response("{}");
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    geo.fix(51.5, -0.13);
    geo.fix(51.6, -0.13);
    const stopped = reason === "stop" ? stopLiveLocationShare(SEAT, { request }) : undefined;
    if (reason === "denied") geo.fail(1);
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(committed).toEqual([]);
    const other = fakeGeolocation();
    startLiveLocationShare({ ...SEAT, via: "crew" }, { geolocation: other.geolocation, request });
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    finish(new Response("{}"));
    await deletion;
    startLiveLocationShare(SEAT, { geolocation: other.geolocation, request });
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    geo.fix(51.7, -0.13);
    expect(committed).toEqual(["PUT"]);
    const stopping = stopLiveLocationShare(SEAT, { request });
    finishDelete();
    await stopped;
    await stopping;
    expect(committed).toEqual(["PUT", "DELETE"]);
    expect(liveShareSnapshot(SEAT.planId).status).toBe(reason === "denied" ? "denied" : "off");
    startLiveLocationShare(SEAT, { geolocation: other.geolocation, request: fakeRoute().request });
    expect(other.spy.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("blocks starts and shares one deletion while a paused share stops", async () => {
    const geo = fakeGeolocation();
    let finish!: (response: Response) => void;
    const request = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const first = stopLiveLocationShare(SEAT, { request });
    const second = stopLiveLocationShare(SEAT, { request });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    expect(geo.spy.watchPosition).not.toHaveBeenCalled();
    expect(liveShareSnapshot(SEAT.planId).status).toBe("stopping");
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    finish(Response.json({ sharing: false }));
    const responses = await Promise.all([first, second]);
    expect(await responses[0].json()).toEqual({ sharing: false });
    expect(await responses[1].json()).toEqual({ sharing: false });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: fakeRoute().request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("stops the watch on an account change even after leaving the Plan", () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    setProviderIdentity("supabase", "live-owner-a");
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    setProviderIdentity("supabase", "live-owner-b");
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    geo.fix(51.5, -0.13);
    expect(route.request).not.toHaveBeenCalled();
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
    setProviderIdentity("supabase", null);
  });

  it("says when the phone has no location service", () => {
    startLiveLocationShare(SEAT, { geolocation: null, request: fakeRoute().request });
    expect(liveShareSnapshot(SEAT.planId).status).toBe("unsupported");
  });
});
