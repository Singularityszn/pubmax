import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { liveLocationRequest, liveShareCrewStopSeat, liveShareSnapshot, reconcileLiveLocationShare, startLiveLocationShare, stopLiveLocationBeforeAccountDeparture, stopLiveLocationShare } from "@/lib/planLiveLocationShare";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import { getAccessToken } from "@/lib/authClient";

vi.mock("@/lib/authClient", () => ({ getAccessToken: vi.fn(async () => "crew-account-token") }));

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

beforeEach(() => {
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.mocked(getAccessToken).mockReset().mockResolvedValue("crew-account-token");
});

afterEach(async () => {
  await stopLiveLocationShare(SEAT, { request: async () => new Response("{}") });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sharing a live location from the phone", () => {
  it("registers a recovered seat even while another Plan owns the watch", async () => {
    setProviderIdentity("supabase", "recovered-owner");
    const geo = fakeGeolocation();
    const other = fakeGeolocation();
    const route = fakeRoute();
    const seat = { planId: "other-plan", via: "crew" as const };
    const fetcher = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    startLiveLocationShare(seat, { geolocation: other.geolocation });
    expect(liveShareSnapshot(seat.planId).status).toBe("busy");
    reconcileLiveLocationShare(seat, { visibility: "member", live: true, sharing: true, endsAt: null, people: [] });
    expect(liveShareCrewStopSeat()).toEqual(seat);
    await stopLiveLocationBeforeAccountDeparture();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toEqual([
      "/api/plans/other-plan/live-location?via=crew", expect.objectContaining({ method: "DELETE" }),
    ]);
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    setProviderIdentity("supabase", null);
  });

  it.each(["plan", "crew"] as const)("revokes active and failed %s sharing with the departing credentials", async (via) => {
    for (const state of ["active", "failed-start", "failed-stop"] as const) {
      setProviderIdentity("supabase", `departing-${via}-${state}`);
      const seat = { ...SEAT, via };
      const geo = fakeGeolocation();
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response("{}", { status: init?.method === "PUT" && state === "failed-start" ? 503 : 200 }));
      vi.stubGlobal("fetch", fetcher);
      startLiveLocationShare(seat, { geolocation: geo.geolocation });
      geo.fix(51.5, -0.13);
      await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe(state === "failed-start" ? "failed" : "on"));
      if (state === "failed-stop") {
        fetcher.mockImplementationOnce(async () => new Response("{}", { status: 503 }));
        await stopLiveLocationShare(seat);
        expect(liveShareSnapshot(SEAT.planId).stopUnconfirmed).toBe(true);
      }
      const departed = stopLiveLocationBeforeAccountDeparture();
      expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
      await departed;
      const init = fetcher.mock.calls.at(-1)![1]!;
      expect(init.method).toBe("DELETE");
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${via === "crew" ? "crew-account-token" : PLAN_HTTP_ONLY_SESSION}`);
      expect(init.signal?.aborted).toBe(false);
      expect(liveShareSnapshot(SEAT.planId)).toMatchObject({ status: "off", stopUnconfirmed: false });
      setProviderIdentity("supabase", null);
    }
  });

  it("permits account departure when an existing Stop stalls", async () => {
    vi.useFakeTimers();
    setProviderIdentity("supabase", "stalled-departing-owner");
    const geo = fakeGeolocation();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetcher);
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation });
    const stopped = stopLiveLocationShare(SEAT).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    let departed = false;
    const departure = stopLiveLocationBeforeAccountDeparture().then(() => { departed = true; });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(departed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await departure;
    await stopped;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(liveShareSnapshot(SEAT.planId)).toMatchObject({ status: "failed", stopUnconfirmed: true });
    setProviderIdentity("supabase", null);
    expect(liveShareSnapshot(SEAT.planId)).toMatchObject({ status: "off", stopUnconfirmed: false });
  });

  it.each(["initial", "moved", "queued", "heartbeat"])("drops a %s fix when hidden during authentication", async (kind) => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const geo = fakeGeolocation();
    const fetcher = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    startLiveLocationShare({ ...SEAT, via: "crew" }, { geolocation: geo.geolocation, now: () => now });
    let finishUpload!: (response: Response) => void;
    if (kind !== "initial") {
      if (kind === "queued") fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishUpload = resolve; }));
      geo.fix(51.5, -0.13);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
      now += 60_000;
    }
    let finishToken!: (token: string) => void;
    let tokenRequested!: () => void;
    const waitingForToken = new Promise<void>((resolve) => { tokenRequested = resolve; });
    vi.mocked(getAccessToken).mockImplementationOnce(() => {
      tokenRequested();
      return new Promise<string>((resolve) => { finishToken = resolve; });
    });
    if (kind === "heartbeat") {
      geo.spy.getCurrentPosition.mockImplementationOnce((success: PositionCallback) => {
        success({ coords: { latitude: 51.6, longitude: -0.13, accuracy: 10 } } as GeolocationPosition);
      });
      await vi.advanceTimersByTimeAsync(60_000);
    } else {
      geo.fix(51.6, -0.13);
      if (kind === "queued") finishUpload(new Response("{}"));
    }
    await waitingForToken;
    vi.stubGlobal("document", { visibilityState: "hidden" });
    finishToken("crew-account-token");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(kind === "initial" ? 0 : 1);
    expect(geo.spy.clearWatch).not.toHaveBeenCalled();
    vi.stubGlobal("document", { visibilityState: "visible" });
    now += 60_000;
    geo.fix(51.7, -0.13);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(kind === "initial" ? 1 : 2);
    const init = fetcher.mock.calls.at(-1)![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      latitude: 51.7, longitude: -0.13, accuracyM: 10,
      ...(kind === "initial" ? { startAt: 1_000_000 } : {}),
    });
  });

  it.each(["active", "failed"])("restores only the current account's %s Crew Stop seat", async (status) => {
    setProviderIdentity("supabase", "crew-stop-owner-a");
    const seat = { ...SEAT, via: "crew" as const };
    const geo = fakeGeolocation();
    startLiveLocationShare(seat, { geolocation: geo.geolocation, request: fakeRoute(404).request });
    if (status === "failed") {
      geo.fix(51.5, -0.13);
      await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("failed"));
    }
    expect(liveShareCrewStopSeat()).toEqual(seat);
    setProviderIdentity("supabase", "crew-stop-owner-b");
    expect(liveShareCrewStopSeat()).toBeNull();
    setProviderIdentity("supabase", null);
  });

  it.each(["asking", "no-signal"])("ends a %s watch at the deadline without another fix", async (status) => {
    vi.useFakeTimers();
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request, endsAt: new Date(Date.now() + 30_000).toISOString() });
    if (status === "no-signal") {
      geo.fix(51.5, -0.13);
      await vi.advanceTimersByTimeAsync(0);
      geo.fail(2);
    }
    await vi.advanceTimersByTimeAsync(29_999);
    expect(geo.spy.clearWatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("ended");
    geo.fix(51.5, -0.13);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(geo.spy.getCurrentPosition).not.toHaveBeenCalled();
    expect(route.request).toHaveBeenCalledTimes(status === "asking" ? 0 : 1);
    const otherSeat = { ...SEAT, planId: "other-plan" };
    startLiveLocationShare(otherSeat, { geolocation: geo.geolocation, request: route.request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(2);
    await stopLiveLocationShare(otherSeat);
  });

  it.each(["deadline", "read"])("retires a failed Stop at night end confirmed by %s", async (confirmation) => {
    vi.useFakeTimers();
    const geo = fakeGeolocation();
    const endsAt = new Date(Date.now() + 30_000).toISOString();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: fakeRoute(503).request, endsAt });
    await stopLiveLocationShare(SEAT);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    if (confirmation === "deadline") await vi.advanceTimersByTimeAsync(30_000);
    else reconcileLiveLocationShare(SEAT, { visibility: "member", live: false, endsAt, sharing: false, people: [] });
    expect(liveShareSnapshot(SEAT.planId).status).toBe("ended");
    const otherSeat = { ...SEAT, planId: "other-plan" };
    startLiveLocationShare(otherSeat, { geolocation: geo.geolocation, request: fakeRoute().request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(2);
    await stopLiveLocationShare(otherSeat);
  });

  it("ignores a Stop response that arrives after the night ended", async () => {
    let finish!: (value: Response) => void;
    const stopped = stopLiveLocationShare(SEAT, { request: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    await Promise.resolve();
    reconcileLiveLocationShare(SEAT, { visibility: "member", live: false, endsAt: null, sharing: false, people: [] });
    finish(new Response("{}", { status: 503 }));
    await stopped;
    expect(liveShareSnapshot(SEAT.planId).status).toBe("ended");
    const geo = fakeGeolocation();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: fakeRoute().request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("does not revive an expired watch when its upload finishes late", async () => {
    vi.useFakeTimers();
    const geo = fakeGeolocation();
    let finish!: (value: Response) => void;
    const request = vi.fn((_seat: unknown, method: string) => method === "PUT"
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : Promise.resolve(new Response("{}")));
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, endsAt: new Date(Date.now() + 30_000).toISOString() });
    geo.fix(51.5, -0.13);
    geo.fix(51.6, -0.13);
    await vi.advanceTimersByTimeAsync(30_000);
    finish(new Response("{}"));
    await vi.advanceTimersByTimeAsync(0);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("ended");
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("asks the browser only when sharing starts, then sends the fix", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    expect(geo.spy.watchPosition).not.toHaveBeenCalled();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request, now: () => 1_000_000 });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
    expect(liveShareSnapshot(SEAT.planId)).toEqual({ planId: SEAT.planId, status: "asking", stopUnconfirmed: false });
    const sent = route.next();
    geo.fix(51.5138, -0.1318);
    await sent;
    expect(route.calls).toEqual([{ method: "PUT", body: { latitude: 51.5138, longitude: -0.1318, accuracyM: 10, startAt: 1_000_000 } }]);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
  });

  it("drops a queued fix when the app hides during a slow upload", async () => {
    vi.useFakeTimers();
    const geo = fakeGeolocation();
    let finish!: (response: Response) => void;
    const request = vi.fn((_seat: unknown, method: string) => method === "PUT"
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : Promise.resolve(new Response("{}")));
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    geo.fix(51.5, -0.13);
    geo.fix(51.6, -0.13);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    finish(new Response("{}"));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    geo.fix(51.7, -0.13);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(geo.spy.getCurrentPosition).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    vi.stubGlobal("document", { visibilityState: "visible" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(geo.spy.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    geo.fix(51.8, -0.13);
    expect(request).toHaveBeenCalledTimes(2);
    finish(new Response("{}"));
    await vi.advanceTimersByTimeAsync(0);
  });

  it.each(["503", "offline"])("requires a fresh tap after an initial %s failure", async (failure) => {
    vi.useFakeTimers();
    let now = 1_000;
    const geo = fakeGeolocation();
    let finish!: (response: Response) => void;
    let reject!: (reason: Error) => void;
    const request = vi.fn<(seat: unknown, method: string, body?: unknown) => Promise<Response>>((_, method) => method === "PUT"
      ? new Promise<Response>((resolve, fail) => { finish = resolve; reject = fail; })
      : Promise.resolve(new Response("{}")));
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, now: () => now });
    geo.fix(51.5, -0.13);
    geo.fix(51.6, -0.13);
    if (failure === "503") finish(new Response("{}", { status: 503 }));
    else reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    geo.fix(51.7, -0.13);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(geo.spy.getCurrentPosition).not.toHaveBeenCalled();
    now = 2_000;
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, now: () => now });
    geo.fix(51.8, -0.13);
    expect(request.mock.calls[1]?.[2]).toMatchObject({ startAt: 2_000 });
    finish(new Response("{}"));
    await vi.advanceTimersByTimeAsync(0);
    now += 60_000;
    geo.fix(52, -0.13);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[2]).not.toHaveProperty("startAt");
    finish(new Response("{}"));
    await vi.advanceTimersByTimeAsync(0);
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

  it("allows Stop after the initial upload commits but loses its response", async () => {
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
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("failed"));
    expect(sharing).toBe(true);
    await stopLiveLocationShare(SEAT, { request });
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
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

  it.each(["active", "paused", "failed"])("keeps a %s Stop unconfirmed after a 404 until the server acknowledges deletion", async (state) => {
    const geo = fakeGeolocation();
    const other = fakeGeolocation();
    const otherSeat = { ...SEAT, planId: "other-plan" };
    const request = fakeRoute(404).request;
    if (state === "active") startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    if (state === "failed") await stopLiveLocationShare(SEAT, { request: fakeRoute(503).request });
    expect((await stopLiveLocationShare(SEAT, { request })).status).toBe(404);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    if (state === "active") expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: fakeRoute().request });
    startLiveLocationShare(SEAT, { geolocation: other.geolocation, request: fakeRoute().request });
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    await stopLiveLocationShare(SEAT, { request: fakeRoute().request });
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
    startLiveLocationShare(otherSeat, { geolocation: other.geolocation, request: fakeRoute().request });
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
    expect(route.calls[1]!.body).toEqual({ latitude: 51.501, longitude: -0.13, accuracyM: 10 });
  });

  it("does not repeat consent after an upload loses its response", async () => {
    const geo = fakeGeolocation();
    let now = 1_000_000;
    const bodies: unknown[] = [];
    const request = vi.fn(async (_seat: unknown, method: string, body?: unknown) => {
      if (method !== "PUT") return new Response("{}");
      bodies.push(body);
      if (bodies.length === 1) return new Response("{}");
      throw new Error("response lost");
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, now: () => now });
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    now += 60_000;
    geo.fix(51.6, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("no-signal"));
    geo.fix(51.7, -0.13);
    await vi.waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies).toEqual([
      { latitude: 51.5, longitude: -0.13, accuracyM: 10, startAt: 1_000_000 },
      { latitude: 51.6, longitude: -0.13, accuracyM: 10 },
      { latitude: 51.7, longitude: -0.13, accuracyM: 10 },
    ]);
  });

  it("turns off after another client stops and needs a new tap to restart", async () => {
    const geo = fakeGeolocation();
    const route = fakeRoute();
    let stoppedElsewhere = false;
    const request = vi.fn(async (seat: unknown, method: string, body?: unknown) => {
      if (method === "PUT" && stoppedElsewhere) {
        return Response.json({ code: "PLAN_LIVE_LOCATION_STOPPED" }, { status: 409 });
      }
      return route.request(seat, method, body);
    });
    let now = 1_000_000;
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, now: () => now });
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    stoppedElsewhere = true;
    now += 60_000;
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("off"));
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    geo.fix(51.6, -0.13);
    expect(request).toHaveBeenCalledTimes(2);
    stoppedElsewhere = false;
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, now: () => now });
    geo.fix(51.6, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    expect(route.calls.at(-1)?.body).toEqual({ latitude: 51.6, longitude: -0.13, accuracyM: 10, startAt: now });
  });

  it("keeps the tap time while GPS waits and switches off when that tap preceded Stop", async () => {
    const geo = fakeGeolocation();
    let now = 1_000_000;
    const request = vi.fn(async (_seat: unknown, method: string, body?: { startAt?: number }) => {
      if (method === "PUT") {
        expect(body?.startAt).toBe(1_000_000);
        return Response.json({ code: "PLAN_LIVE_LOCATION_STOPPED" }, { status: 409 });
      }
      return new Response("{}");
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request, now: () => now });
    now += 2_000;
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("off"));
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
  });

  it.each(["success", "refusal", "abort"])("retires the old account's Stop before its late %s", async (result) => {
    setProviderIdentity("supabase", "stopping-owner-a");
    let finish!: (value: Response) => void;
    let reject!: (reason: Error) => void;
    const request = vi.fn(() => new Promise<Response>((resolve, refuse) => { finish = resolve; reject = refuse; }));
    const stopped = stopLiveLocationShare(SEAT, { request }).catch(() => undefined);
    await Promise.resolve();
    setProviderIdentity("supabase", "stopping-owner-b");
    const geo = fakeGeolocation();
    const route = fakeRoute();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: route.request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
    geo.fix(51.5, -0.13);
    await vi.waitFor(() => expect(liveShareSnapshot(SEAT.planId).status).toBe("on"));
    if (result === "abort") reject(new Error("aborted"));
    else finish(new Response("{}", { status: result === "success" ? 200 : 503 }));
    await stopped;
    expect(liveShareSnapshot(SEAT.planId).status).toBe("on");
    await stopLiveLocationShare(SEAT);
    setProviderIdentity("supabase", null);
  });

  it("retires an unconfirmed Stop when its account changes", async () => {
    setProviderIdentity("supabase", "failed-stop-owner-a");
    await stopLiveLocationShare(SEAT, { request: async () => new Response("{}", { status: 503 }) });
    setProviderIdentity("supabase", "failed-stop-owner-b");
    const geo = fakeGeolocation();
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request: fakeRoute().request });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
    await stopLiveLocationShare(SEAT);
    setProviderIdentity("supabase", null);
  });

  it.each(["credentials", "network"])("permits another Stop after stalled %s time out", async (stage) => {
    vi.useFakeTimers();
    const seat = { ...SEAT, via: "crew" as const };
    const geo = fakeGeolocation();
    const fetcher = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    startLiveLocationShare(seat, { geolocation: geo.geolocation });
    if (stage === "credentials") {
      vi.mocked(getAccessToken).mockImplementationOnce(() => new Promise(() => {}));
    } else {
      fetcher.mockImplementationOnce(() => new Promise(() => {}));
    }
    const stopped = stopLiveLocationShare(seat).catch((error: unknown) => error);
    const duplicate = stopLiveLocationShare(seat).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await stopped).toBeInstanceOf(Error);
    expect(await duplicate).toBeInstanceOf(Error);
    expect(geo.spy.clearWatch).toHaveBeenCalledWith(7);
    expect(liveShareSnapshot(seat.planId)).toMatchObject({ status: "failed", stopUnconfirmed: true });
    startLiveLocationShare(seat, { geolocation: geo.geolocation });
    expect(geo.spy.watchPosition).toHaveBeenCalledTimes(1);
    expect((await stopLiveLocationShare(seat)).ok).toBe(true);
    expect(liveShareSnapshot(seat.planId)).toMatchObject({ status: "off", stopUnconfirmed: false });
    if (stage === "network") expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(true);
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

  it.each(["stop", "denied"])("revokes sharing without waiting for a stalled PUT on %s", async (reason) => {
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
    await deletion;
    startLiveLocationShare(SEAT, { geolocation: other.geolocation, request });
    expect(other.spy.watchPosition).not.toHaveBeenCalled();
    geo.fix(51.7, -0.13);
    expect(committed).toEqual([]);
    const stopping = stopLiveLocationShare(SEAT, { request });
    finishDelete();
    await stopped;
    await stopping;
    expect(committed).toEqual(["DELETE"]);
    expect(liveShareSnapshot(SEAT.planId).status).toBe(reason === "denied" ? "denied" : "off");
    finish(new Response("{}"));
    await Promise.resolve();
    expect(liveShareSnapshot(SEAT.planId).status).toBe(reason === "denied" ? "denied" : "off");
    startLiveLocationShare(SEAT, { geolocation: other.geolocation, request: fakeRoute().request });
    expect(other.spy.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("retries a failed Stop while the old upload remains stalled", async () => {
    const geo = fakeGeolocation();
    let finish!: (response: Response) => void;
    let deletions = 0;
    const request = vi.fn(async (_seat: unknown, method: string) => {
      if (method === "PUT") return new Promise<Response>((resolve) => { finish = resolve; });
      deletions += 1;
      return new Response("{}", { status: deletions === 1 ? 503 : 200 });
    });
    startLiveLocationShare(SEAT, { geolocation: geo.geolocation, request });
    geo.fix(51.5, -0.13);
    expect((await stopLiveLocationShare(SEAT)).status).toBe(503);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    expect((await stopLiveLocationShare(SEAT, { request })).status).toBe(200);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
    finish(new Response("{}"));
    await Promise.resolve();
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
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

describe("live location request transport", () => {
  it.each(["plan", "crew"] as const)("blocks hidden %s uploads while allowing reads and Stop", async (via) => {
    const fetcher = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const seat = { ...SEAT, via };
    await expect(liveLocationRequest(seat, "PUT", { latitude: 51.5, longitude: -0.13, accuracyM: 10 }))
      .rejects.toThrow("Location upload skipped while hidden");
    expect(fetcher).not.toHaveBeenCalled();
    await liveLocationRequest(seat, "GET");
    await liveLocationRequest(seat, "DELETE");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["GET", "PUT", "DELETE"] as const)("sends private %s requests with the Plan capability or Crew account", async (method) => {
    const fetcher = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const body = method === "PUT" ? { latitude: 51.5, longitude: -0.13, accuracyM: 10 } : undefined;
    for (const [seat, token, query] of [
      [SEAT, PLAN_HTTP_ONLY_SESSION, ""],
      [{ ...SEAT, memberToken: "member-capability" }, "member-capability", ""],
      [{ ...SEAT, via: "crew" as const }, "crew-account-token", "?via=crew"],
    ] as const) {
      const controller = new AbortController();
      await liveLocationRequest(seat, method, body, controller.signal);
      const [url, init] = fetcher.mock.calls.at(-1)! as unknown as [string, RequestInit];
      expect(url).toBe(`/api/plans/${SEAT.planId}/live-location${query}`);
      expect(init).toMatchObject({ method, cache: "no-store", credentials: "same-origin" });
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
      expect(init.body).toBe(body ? JSON.stringify(body) : undefined);
      controller.abort();
      expect(init.signal?.aborted).toBe(true);
    }
  });
});
