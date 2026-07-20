import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAccessTokenMock, readActivePlanMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn<() => Promise<string | null>>(async () => null),
  readActivePlanMock: vi.fn(() => null as { id: string; role: "host" | "guest" | null } | null),
}));

vi.mock("@/lib/authClient", () => ({ getAccessToken: getAccessTokenMock }));
vi.mock("@/lib/activePlan", () => ({ readActivePlan: readActivePlanMock }));

import {
  __resetPushIdentityClient,
  currentPushRegistration,
  linkCurrentPushToClaimedAccount,
  linkCurrentPushToPlan,
  rememberPushRegistration,
  subscribePushRegistration,
  unlinkAllPushFromClaimedAccount,
  unlinkCurrentPushFromClaimedAccount,
  unlinkCurrentPushFromPlan,
} from "@/lib/pushIdentityClient";

function storageHarness(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

beforeEach(() => {
  __resetPushIdentityClient();
  getAccessTokenMock.mockReset();
  getAccessTokenMock.mockResolvedValue(null);
  readActivePlanMock.mockReset();
  readActivePlanMock.mockReturnValue(null);
  const events = new EventTarget();
  vi.stubGlobal("window", {
    sessionStorage: storageHarness(),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
  vi.stubGlobal("navigator", {});
});

async function rememberDevice(): Promise<void> {
  rememberPushRegistration({ token: "device-token", platform: "ios" });
  // Let the opportunistic signed-in join observe the default signed-out mock
  // before a test changes it. This keeps assertions about explicit calls exact.
  await vi.waitFor(() => expect(getAccessTokenMock).toHaveBeenCalled());
  getAccessTokenMock.mockClear();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("push identity client", () => {
  it("remembers only delivery material and does not invent identity fields", async () => {
    await rememberDevice();
    expect(await currentPushRegistration()).toEqual({ token: "device-token", platform: "ios" });
    expect(window.sessionStorage.length).toBe(0);
  });

  it("joins a claimed account with the verified bearer and no client user id", async () => {
    await rememberDevice();
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(linkCurrentPushToClaimedAccount()).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer verified-jwt");
    expect(JSON.parse(String(init?.body))).toEqual({ token: "device-token", platform: "ios" });
  });

  it("unlinks the current account before logout and supports all-device privacy cleanup", async () => {
    await rememberDevice();
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(unlinkCurrentPushFromClaimedAccount()).resolves.toBe(true);
    await expect(unlinkAllPushFromClaimedAccount()).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => [init?.method, JSON.parse(String(init?.body))])).toEqual([
      ["DELETE", { token: "device-token", platform: "ios" }],
      ["DELETE", { all: true }],
    ]);
  });

  it("joins and revokes a Plan with capability but no client member id", async () => {
    await rememberDevice();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(linkCurrentPushToPlan("plan-id", "member-capability")).resolves.toBe(true);
    await expect(unlinkCurrentPushFromPlan("plan-id", "member-capability")).resolves.toBe(true);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("/api/plans/plan-id/push-tokens");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer member-capability");
      expect(JSON.parse(String(init?.body))).toEqual({ token: "device-token", platform: "ios" });
    }
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "DELETE"]);
  });

  it("does not call account or Plan routes without a registration", async () => {
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(linkCurrentPushToClaimedAccount()).resolves.toBe(false);
    await expect(linkCurrentPushToPlan("plan-id", "member-capability")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wakes a waiting Plan join when an async native token arrives", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribePushRegistration(listener);
    await rememberDevice();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    rememberPushRegistration({ token: "new-token", platform: "ios" });
    expect(listener).toHaveBeenCalledOnce();
  });
});
