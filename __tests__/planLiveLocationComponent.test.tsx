// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Map as LiveMap } from "maplibre-gl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapLiveOverlays from "@/components/map/liveOverlays/MapLiveOverlays";
import PlanLiveLocation from "@/components/plan/PlanLiveLocation";
import { setProviderIdentity } from "@/lib/authProviderRevision";
import { rememberLiveLocationNight } from "@/lib/liveLocationNight";
import { liveShareCrewStopSeat, liveShareSnapshot, stopLiveLocationBeforeAccountDeparture, stopLiveLocationShare } from "@/lib/planLiveLocationShare";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => createElement("a", { href }, children),
}));
vi.mock("next/dynamic", async () => {
  const { default: Layer } = await import("@/components/map/liveOverlays/CrewLiveLocationLayer");
  return { default: () => Layer };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    delete props.variant;
    return createElement("button", props);
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEAT = { planId: "11111111-1111-4111-8111-111111111111", via: "plan" as const, memberToken: "seat-a" };
let root: Root;
let container: HTMLDivElement;
let sharing: boolean;
let watch: ReturnType<typeof vi.fn>;
let clearWatch: ReturnType<typeof vi.fn>;
let fix: PositionCallback;
let fail: PositionErrorCallback | null | undefined;
let fetcher: ReturnType<typeof vi.fn>;

function view() {
  return { visibility: "member", live: true, sharing, endsAt: new Date(Date.now() + 60_000).toISOString(), people: [] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  setProviderIdentity("supabase", "component-owner-a");
  sharing = false;
  watch = vi.fn((success: PositionCallback, error?: PositionErrorCallback | null) => { fix = success; fail = error; return 7; });
  clearWatch = vi.fn();
  vi.stubGlobal("navigator", {
    geolocation: { watchPosition: watch, clearWatch, getCurrentPosition: vi.fn() },
    permissions: { query: vi.fn(async () => ({ state: "granted" })) },
  });
  fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") sharing = true;
    if (init?.method === "DELETE") sharing = false;
    return Response.json(view());
  });
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await stopLiveLocationShare(SEAT, { request: async () => Response.json({}) });
  setProviderIdentity("supabase", null);
  localStorage.clear();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mountPlan(ownerKey = "owner-a") {
  await act(async () => root.render(createElement(PlanLiveLocation, { seat: SEAT, ownerKey })));
}

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}

describe("live location consent at the account boundary", () => {
  it.each(["plan", "map"])("registers a recovered %s share for departure without resuming", async (surface) => {
    sharing = true;
    const seat = { ...SEAT, via: "crew" as const };
    if (surface === "plan") {
      await act(async () => root.render(createElement(PlanLiveLocation, { seat, ownerKey: "owner-a" })));
      expect(container.textContent).toContain("Resume sharing");
      expect(container.textContent).toContain("Stop sharing");
    } else {
      rememberLiveLocationNight({ planId: seat.planId, via: seat.via, endsAt: view().endsAt });
      const map = { on: vi.fn(), off: vi.fn(), getCanvasContainer: () => container } as unknown as LiveMap;
      await act(async () => root.render(createElement(MapLiveOverlays, { map, sunChaserOn: false, venues: [] })));
    }
    expect(liveShareCrewStopSeat()).toMatchObject({ planId: seat.planId, via: "crew" });
    await act(async () => stopLiveLocationBeforeAccountDeparture());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(sharing).toBe(false);
    expect(watch).not.toHaveBeenCalled();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it.each(["503", "offline"])("withholds Resume until an unconfirmed Stop succeeds after %s", async (failure) => {
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    let finishStop!: () => void;
    let failStop = true;
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        if (failStop) {
          await new Promise<void>((resolve) => { finishStop = resolve; });
          if (failure === "offline") throw new Error("offline");
          return Response.json({}, { status: 503 });
        }
        sharing = false;
      }
      return Response.json(view());
    });
    await click("Stop sharing");
    expect(container.textContent).not.toContain("Resume");
    await act(async () => finishStop());
    expect(container.textContent).not.toContain("Resume");
    expect(container.textContent).toContain("Stop sharing");
    expect(watch).toHaveBeenCalledTimes(1);
    failStop = false;
    await click("Stop sharing");
    expect(sharing).toBe(false);
    await click("Share my location tonight");
    expect(watch).toHaveBeenCalledTimes(2);
  });

  it("offers a fresh-tap retry after the first upload fails", async () => {
    await mountPlan();
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => init?.method === "PUT"
      ? Response.json({}, { status: 503 })
      : Response.json(view()));
    await click("Share my location tonight");
    const firstTap = Date.now();
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(container.textContent).toContain("Resume sharing");
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") sharing = true;
      return Response.json(view());
    });
    await click("Resume sharing");
    await act(async () => fix({ coords: { latitude: 51.6, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    const uploads = fetcher.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(uploads).toHaveLength(2);
    expect(JSON.parse(uploads[0]![1].body).startAt).toBe(firstTap);
    expect(JSON.parse(uploads[1]![1].body).startAt).toBe(firstTap + 1_000);
    expect(sharing).toBe(true);
    expect(container.textContent).toContain("Stop sharing");
  });

  it("keeps the known deadline after leaving the Plan without a GPS fix", async () => {
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("ended");
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it.each(["plan", "map"])("ends the watch when an authorised %s read closes the night", async (surface) => {
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => fail?.({ code: 2 } as GeolocationPositionError));
    if (surface === "map") {
      const map = { on: vi.fn(), off: vi.fn(), getCanvasContainer: () => container } as unknown as LiveMap;
      await act(async () => root.render(createElement(MapLiveOverlays, { map, sunChaserOn: false, venues: [] })));
    }
    fetcher.mockImplementation(async () => Response.json({ ...view(), live: false, sharing: false }));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("ended");
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(120_000));
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    const otherSeat = { ...SEAT, planId: "22222222-2222-4222-8222-222222222222" };
    fetcher.mockImplementation(async () => Response.json(view()));
    await act(async () => root.render(createElement(PlanLiveLocation, { seat: otherSeat, ownerKey: "owner-a" })));
    await click("Share my location tonight");
    expect(watch).toHaveBeenCalledTimes(2);
    await act(async () => stopLiveLocationShare(otherSeat));
  });

  it("does not restore sharing after a person starts, polls, then stops", async () => {
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await click("Stop sharing");
    expect(watch).toHaveBeenCalledTimes(1);
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(sharing).toBe(false);
  });

  it.each(["stop", "account", "unmount"])("does not start a stored share on %s", async (action) => {
    sharing = true;
    await mountPlan();
    expect(watch).not.toHaveBeenCalled();
    if (action === "stop") await click("Stop sharing");
    if (action === "account") {
      await act(async () => setProviderIdentity("supabase", "component-owner-b"));
      await mountPlan("owner-b");
      expect(container.textContent).toContain("Resume sharing");
    }
    if (action === "unmount") await act(async () => root.render(null));
    expect(watch).not.toHaveBeenCalled();
  });

  it("keeps a stored share paused until the person taps Resume", async () => {
    sharing = true;
    await mountPlan();
    expect(watch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Stop sharing");
    await click("Resume sharing");
    expect(watch).toHaveBeenCalledTimes(1);
  });

  it("clears a stored sharing view after another client stops", async () => {
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    sharing = false;
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => init?.method === "PUT"
      ? Response.json({ code: "PLAN_LIVE_LOCATION_STOPPED" }, { status: 409 })
      : Response.json(view()));
    vi.setSystemTime(Date.now() + 60_000);
    await act(async () => fix({ coords: { latitude: 51.6, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(container.textContent).toContain("Share my location tonight");
    expect(container.textContent).not.toContain("Resume sharing");
    expect(container.textContent).not.toContain("Stop sharing");
  });

  it("keeps the active Plan live when another panel refuses sharing", async () => {
    const otherSeat = { ...SEAT, planId: "22222222-2222-4222-8222-222222222222" };
    fetcher.mockImplementation(async (input: unknown, init?: RequestInit) => {
      if (String(input).includes(otherSeat.planId)) return Response.json({ ...view(), sharing: false });
      if (init?.method === "PUT") sharing = true;
      if (init?.method === "DELETE") sharing = false;
      return Response.json(view());
    });
    await act(async () => root.render(createElement("div", null,
      createElement(PlanLiveLocation, { seat: SEAT, ownerKey: "owner-a" }),
      createElement(PlanLiveLocation, { seat: otherSeat, ownerKey: "owner-a" }),
    )));
    await click("Share my location tonight");
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    await click("Share my location tonight");
    const panels = container.querySelectorAll("section");
    expect(panels[0]!.textContent).toContain("You're sharing your live location");
    expect(panels[0]!.textContent).not.toContain("Resume sharing");
    expect(panels[1]!.textContent).toContain("already sharing with another night");
    expect(watch).toHaveBeenCalledTimes(1);
    expect(clearWatch).not.toHaveBeenCalled();
  });

  it("offers Stop after permission withdrawal fails to delete the first spot", async () => {
    let failDelete = true;
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") sharing = true;
      if (init?.method === "DELETE") {
        if (failDelete) return Response.json({}, { status: 503 });
        sharing = false;
      }
      return Response.json(view());
    });
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    await act(async () => fail?.({ code: 1 } as GeolocationPositionError));
    expect(sharing).toBe(true);
    expect(container.textContent).toContain("Your last spot may still show");
    expect(container.textContent).not.toContain("nobody can see you");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Stop sharing")).toBe(true);
    failDelete = false;
    await click("Stop sharing");
    expect(sharing).toBe(false);
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it.each(["asking", "on", "no-signal", "failed"])("keeps Stop available after remounting a %s share during a read failure", async (status) => {
    await mountPlan();
    await click("Share my location tonight");
    if (status !== "asking") {
      await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    }
    if (status === "no-signal") await act(async () => fail?.({ code: 2 } as GeolocationPositionError));
    if (status === "failed") {
      fetcher.mockResolvedValue(Response.json({}, { status: 503 }));
      await click("Stop sharing");
    }
    await act(async () => root.render(null));
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method !== "DELETE") return Response.json({}, { status: 503 });
      sharing = false;
      return Response.json(view());
    });
    await mountPlan();
    expect(container.textContent).toContain("We couldn't check who's sharing");
    await click("Stop sharing");
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(sharing).toBe(false);
    expect(container.textContent).not.toContain("Stop sharing");
    expect(watch).toHaveBeenCalledTimes(1);
  });

  it("keeps Stop controls after an unconfirmed 404 and permits a retry", async () => {
    await mountPlan();
    await click("Share my location tonight");
    await act(async () => fix({ coords: { latitude: 51.5, longitude: -0.13, accuracy: 10 } } as GeolocationPosition));
    fetcher.mockResolvedValue(Response.json({}, { status: 404 }));
    await click("Stop sharing");
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(sharing).toBe(true);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("failed");
    expect(container.textContent).toContain("Your last spot may still show");
    fetcher.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        sharing = false;
        return Response.json(view());
      }
      return Response.json({}, { status: 404 });
    });
    await click("Stop sharing");
    expect(sharing).toBe(false);
    expect(liveShareSnapshot(SEAT.planId).status).toBe("off");
    expect(container.textContent).not.toContain("Stop sharing");
  });

  it("removes the old account's map dots before the next read finishes", async () => {
    const canvas = document.createElement("div");
    container.append(canvas);
    const map = {
      on: vi.fn(), off: vi.fn(), project: () => ({ x: 50, y: 50 }),
      getContainer: () => ({ getBoundingClientRect: () => ({ width: 400, height: 400 }) }),
      getCanvasContainer: () => canvas,
    } as unknown as LiveMap;
    const person = { memberId: "mate", name: "Private mate", latitude: 51.5, longitude: -0.13, accuracyM: 10, updatedAt: new Date().toISOString() };
    fetcher.mockResolvedValue(Response.json({ ...view(), people: [person] }));
    rememberLiveLocationNight({ ...SEAT, endsAt: view().endsAt });
    await act(async () => root.render(createElement(MapLiveOverlays, { map, sunChaserOn: false, venues: [] })));
    expect(canvas.textContent).toContain("Private mate");
    let finish!: (value: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await act(async () => setProviderIdentity("supabase", "component-owner-b"));
    expect(canvas.textContent).not.toContain("Private mate");
    await act(async () => finish(Response.json({}, { status: 404 })));
    expect(canvas.textContent).not.toContain("Private mate");
  });

  it.each(["plan", "map"])("ignores superseded %s reads and errors after a newer empty result", async (surface) => {
    const canvas = document.createElement("div");
    const map = {
      on: vi.fn(), off: vi.fn(), project: () => ({ x: 50, y: 50 }),
      getContainer: () => ({ getBoundingClientRect: () => ({ width: 400, height: 400 }) }),
      getCanvasContainer: () => canvas,
    } as unknown as LiveMap;
    const target = surface === "map" ? canvas : container;
    const person = { memberId: "mate", name: "Private mate", latitude: 51.5, longitude: -0.13, accuracyM: 10, updatedAt: new Date().toISOString() };
    const pending: { resolve: (response: Response) => void; reject: (error: Error) => void; signal?: AbortSignal | null }[] = [];
    fetcher.mockImplementation((_input: unknown, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject, signal: init?.signal });
    }));
    if (surface === "map") {
      rememberLiveLocationNight({ ...SEAT, endsAt: view().endsAt });
      await act(async () => root.render(createElement(MapLiveOverlays, { map, sunChaserOn: false, venues: [] })));
    } else await mountPlan();
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal?.aborted).toBe(true);
    await act(async () => pending[1]!.resolve(Response.json(view())));
    await act(async () => pending[0]!.resolve(Response.json({ ...view(), sharing: true, people: [person] })));
    expect(target.textContent).not.toContain("Private mate");
    if (surface === "plan") expect(target.textContent).not.toContain("Resume sharing");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => pending[3]!.resolve(Response.json({ ...view(), people: [person] })));
    await act(async () => pending[2]!.reject(new Error("offline")));
    expect(target.textContent).toContain("Private mate");
    expect(target.textContent).not.toContain("We couldn't check who's sharing");
  });

  it("keeps map polling at 15 seconds through unrelated parent renders", async () => {
    const canvas = document.createElement("div");
    const map = {
      on: vi.fn(), off: vi.fn(),
      getCanvasContainer: () => canvas,
    } as unknown as LiveMap;
    rememberLiveLocationNight({ ...SEAT, endsAt: view().endsAt });
    const render = () => root.render(createElement(MapLiveOverlays, { map, sunChaserOn: false, venues: [] }));
    await act(async () => { render(); await vi.advanceTimersByTimeAsync(0); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => render());
    await act(async () => render());
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
