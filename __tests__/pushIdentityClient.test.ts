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
  resumeAccountPushJoins,
  stopAccountPushJoins,
  subscribePushRegistration,
  unlinkAllPushFromClaimedAccount,
  unlinkCurrentPushFromClaimedAccount,
  unlinkCurrentPushFromPlan,
  unlinkPushRegistrationFromClaimedAccount,
  unlinkPushInstallationFromClaimedAccount,
} from "@/lib/pushIdentityClient";
import { __resetPushInstallation } from "@/lib/pushInstallation";

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
  __resetPushInstallation();
  getAccessTokenMock.mockReset();
  getAccessTokenMock.mockResolvedValue(null);
  readActivePlanMock.mockReset();
  readActivePlanMock.mockReturnValue(null);
  const events = new EventTarget();
  vi.stubGlobal("window", {
    sessionStorage: storageHarness(),
    localStorage: storageHarness(),
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

    await expect(linkCurrentPushToClaimedAccount()).resolves.toEqual({ ok: true, status: "linked" });
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer verified-jwt");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      token: "device-token",
      platform: "ios",
      installationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      mutationVersion: expect.any(Number),
    });
  });

  it("unlinks the current account before logout and supports all-device privacy cleanup", async () => {
    await rememberDevice();
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(unlinkCurrentPushFromClaimedAccount()).resolves.toEqual({ ok: true, status: "unlinked" });
    await expect(unlinkAllPushFromClaimedAccount()).resolves.toEqual({ ok: true, status: "unlinked" });
    const calls = fetchMock.mock.calls.map(([, init]) => [init?.method, JSON.parse(String(init?.body))] as const);
    expect(calls[0][0]).toBe("DELETE");
    expect(calls[0][1]).toMatchObject({ token: "device-token", platform: "ios" });
    expect(calls[1][0]).toBe("DELETE");
    expect(calls[1][1]).toMatchObject({ all: true });
    expect(calls[1][1].mutationVersion).toBeGreaterThan(calls[0][1].mutationVersion);
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
      expect(JSON.parse(String(init?.body))).toMatchObject({
        token: "device-token",
        platform: "ios",
        installationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        mutationVersion: expect.any(Number),
      });
    }
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "DELETE"]);
  });

  it("does not call account or Plan routes without a registration", async () => {
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(linkCurrentPushToClaimedAccount()).resolves.toEqual({ ok: true, status: "no_registration" });
    await expect(linkCurrentPushToPlan("plan-id", "member-capability")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat an empty volatile registration as a successful unlink", async () => {
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(unlinkCurrentPushFromClaimedAccount()).resolves.toEqual({ ok: false, status: "retryable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drains an accepted account POST and sends DELETE last during logout", async () => {
    await rememberDevice();
    resumeAccountPushJoins();
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    let resolvePost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const methods: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const method = String(init?.method);
      methods.push(method);
      if (method === "POST") return postResponse;
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const linking = linkCurrentPushToClaimedAccount();
    await vi.waitFor(() => expect(methods).toEqual(["POST"]));
    stopAccountPushJoins();
    const unlinking = unlinkPushRegistrationFromClaimedAccount({ token: "device-token", platform: "ios" });
    await Promise.resolve();
    expect(methods).toEqual(["POST"]);
    resolvePost(new Response(null, { status: 200 }));
    await linking;
    await expect(unlinking).resolves.toEqual({ ok: true, status: "unlinked" });
    expect(methods).toEqual(["POST", "DELETE"]);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { mutationVersion: number });
    expect(bodies[1].mutationVersion).toBeGreaterThan(bodies[0].mutationVersion);
  });

  it("stops new joins synchronously once logout begins", async () => {
    await rememberDevice();
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stopAccountPushJoins();
    await expect(linkCurrentPushToClaimedAccount()).resolves.toEqual({ ok: false, status: "stopped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revokes the opaque installation without a raw provider token", async () => {
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    stopAccountPushJoins();
    await expect(unlinkPushInstallationFromClaimedAccount()).resolves.toEqual({
      ok: true,
      status: "unlinked",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      installationOnly: true,
      installationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      mutationVersion: expect.any(Number),
    });
  });

  it("recovers Web PushManager state after reload and retries bounded transient failures", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/recovered",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve({ pushManager: { getSubscription: vi.fn(async () => ({ toJSON: () => subscription })) } }),
      },
    });
    getAccessTokenMock.mockResolvedValue("verified-jwt");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(linkCurrentPushToClaimedAccount()).resolves.toEqual({ ok: true, status: "linked" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("serializes Plan link and unlink despite response reordering pressure", async () => {
    await rememberDevice();
    let resolvePost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const methods: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const method = String(init?.method);
      methods.push(method);
      return method === "POST" ? postResponse : new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const link = linkCurrentPushToPlan("plan-id", "member-capability");
    await vi.waitFor(() => expect(methods).toEqual(["POST"]));
    const unlink = unlinkCurrentPushFromPlan("plan-id", "member-capability");
    await Promise.resolve();
    expect(methods).toEqual(["POST"]);
    resolvePost(new Response(null, { status: 200 }));
    await expect(link).resolves.toBe(true);
    await expect(unlink).resolves.toBe(true);
    expect(methods).toEqual(["POST", "DELETE"]);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { mutationVersion: number });
    expect(bodies[1].mutationVersion).toBeGreaterThan(bodies[0].mutationVersion);
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
