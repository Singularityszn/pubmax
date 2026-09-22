import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerWebPush,
  unregisterWebPush,
  unsubscribeWebPushToken,
} from "@/lib/webPush";
import { markPublicWebPushToken } from "@/lib/webPushRegistrationState";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type BrowserHarnessOptions = Readonly<{
  ready?: Promise<Pick<ServiceWorkerRegistration, "pushManager">>;
  subscribe?: () => Promise<PushSubscription>;
  fetch?: typeof globalThis.fetch;
}>;

function browserHarness(options: BrowserHarnessOptions = {}) {
  const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  const subscription = {
    toJSON: () => ({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/browser",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    }),
  } as unknown as PushSubscription;
  const subscribe = vi.fn(options.subscribe ?? (async () => subscription));
  const getSubscription = vi.fn(async () => null);
  const ready = options.ready
    ?? Promise.resolve({ pushManager: { getSubscription, subscribe } } as unknown as Pick<
      ServiceWorkerRegistration,
      "pushManager"
    >);
  vi.stubGlobal("window", { PushManager: class {}, Notification: {} });
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready,
    },
  });
  const fetch = vi.fn<typeof globalThis.fetch>(
    options.fetch ?? (async () => new Response(null, { status: 200 })),
  );
  vi.stubGlobal("fetch", fetch);
  return { requestPermission, subscribe, fetch, subscription };
}

async function flushRegistrationMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("registerWebPush", () => {
  it("does not ask permission when the public key is absent", async () => {
    const { requestPermission, fetch } = browserHarness();
    expect(await registerWebPush()).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("registers an identity-free subscription only when explicitly invoked", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    const { requestPermission, subscribe, fetch } = browserHarness();

    const token = await registerWebPush();
    expect(token).toMatch(/^webpush:/);
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    }));
    expect(fetch).toHaveBeenCalledWith("/api/push-tokens", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"platform":"web"'),
    }));
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body).toEqual({ token: expect.stringMatching(/^webpush:/), platform: "web" });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("planId");
  });

  it("stops waiting when the service worker never becomes ready", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    browserHarness({
      ready: new Promise<Pick<ServiceWorkerRegistration, "pushManager">>(() => undefined),
    });

    const registration = registerWebPush();
    let settled = false;
    void registration.then(() => {
      settled = true;
    });
    await flushRegistrationMicrotasks();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled).toBe(true);
    await expect(registration).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops waiting when browser subscription work never settles", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    const { subscribe } = browserHarness({
      subscribe: () => new Promise<PushSubscription>(() => undefined),
    });

    const registration = registerWebPush();
    let settled = false;
    void registration.then(() => {
      settled = true;
    });
    await flushRegistrationMicrotasks();
    expect(subscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled).toBe(true);
    await expect(registration).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a registration request that exceeds the registration deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    const requestSignals: AbortSignal[] = [];
    const { fetch } = browserHarness({
      fetch: (_input, init) => {
        requestSignals.push(init?.signal as AbortSignal);
        return new Promise<Response>(() => undefined);
      },
    });

    const registration = registerWebPush();
    let settled = false;
    void registration.then(() => {
      settled = true;
    });
    await flushRegistrationMicrotasks();
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled).toBe(true);
    await expect(registration).resolves.toBeNull();
    expect(requestSignals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the caller cancel a pending service-worker wait", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    browserHarness({
      ready: new Promise<Pick<ServiceWorkerRegistration, "pushManager">>(() => undefined),
    });
    const controller = new AbortController();

    const registration = registerWebPush(controller.signal);
    let settled = false;
    void registration.then(() => {
      settled = true;
    });
    await flushRegistrationMicrotasks();
    controller.abort();
    await flushRegistrationMicrotasks();

    expect(settled).toBe(true);
    await expect(registration).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not ask permission when the caller already cancelled", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    const { requestPermission, fetch } = browserHarness();
    const controller = new AbortController();
    controller.abort();

    await expect(registerWebPush(controller.signal)).resolves.toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears the registration deadline after successful registration", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    browserHarness();

    await expect(registerWebPush()).resolves.toMatch(/^webpush:/);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("unsubscribeWebPushToken", () => {
  it("does not claim retirement when the installed subscription is unreadable", async () => {
    const values = new Map<string, string>();
    const token = encodeWebPushSubscription({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/unreadable",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    })!;
    vi.stubGlobal("window", {
      PushManager: class {},
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => {
          throw new Error("service worker unavailable");
        },
      },
    });
    expect(markPublicWebPushToken(token)).toBe(true);
    values.set("pubmax:webPush:enabled:v1", "1");

    await expect(unregisterWebPush()).resolves.toBe(false);

    expect(values.get("pubmax_public_web_push_token")).toBe(token);
    expect(values.get("pubmax:webPush:enabled:v1")).toBe("1");
  });

  it("fails closed when the current subscription cannot be encoded", async () => {
    const expectedToken = encodeWebPushSubscription({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/expected",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    })!;
    const unsubscribe = vi.fn(async () => true);
    vi.stubGlobal("window", { PushManager: class {} });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              toJSON: () => ({ endpoint: "malformed" }),
              unsubscribe,
            }),
          },
        }),
      },
    });

    await expect(unsubscribeWebPushToken(expectedToken)).resolves.toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("fails closed when post-unsubscribe state cannot be encoded", async () => {
    const values = new Map<string, string>();
    const subscriptionJson = {
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/post-read",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    const token = encodeWebPushSubscription(subscriptionJson)!;
    const current = {
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn(async () => true),
    };
    const malformedRemaining = {
      toJSON: () => ({ endpoint: "malformed" }),
      unsubscribe: vi.fn(async () => false),
    };
    const getSubscription = vi.fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(malformedRemaining);
    vi.stubGlobal("window", {
      PushManager: class {},
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => ({ pushManager: { getSubscription } }),
      },
    });
    expect(markPublicWebPushToken(token)).toBe(true);

    await expect(unsubscribeWebPushToken(token)).resolves.toBe(false);
    expect(values.get("pubmax_public_web_push_token")).toBe(token);
  });

  it("clears exact public consent after physical retirement", async () => {
    const values = new Map<string, string>();
    const subscriptionJson = {
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/retire-public",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    const token = encodeWebPushSubscription(subscriptionJson)!;
    const subscription = {
      toJSON: () => subscriptionJson,
      unsubscribe: vi.fn(async () => true),
    };
    const getSubscription = vi.fn()
      .mockResolvedValueOnce(subscription)
      .mockResolvedValueOnce(null);
    vi.stubGlobal("window", {
      PushManager: class {},
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => ({ pushManager: { getSubscription } }),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    expect(markPublicWebPushToken(token)).toBe(true);
    values.set("pubmax:webPush:enabled:v1", "1");

    await expect(unsubscribeWebPushToken(token)).resolves.toBe(true);

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(values.has("pubmax_public_web_push_token")).toBe(false);
    expect(values.has("pubmax:webPush:enabled:v1")).toBe(false);
  });

  it("fails closed within a ceiling when unsubscribe never settles", async () => {
    vi.useFakeTimers();
    const subscriptionJson = {
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/retire",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    const token = encodeWebPushSubscription(subscriptionJson)!;
    const subscription = {
      toJSON: () => subscriptionJson,
      unsubscribe: () => new Promise<boolean>(() => undefined),
    };
    vi.stubGlobal("window", { PushManager: class {} });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => subscription },
        }),
      },
    });
    vi.stubGlobal("fetch", vi.fn());

    const retirement = unsubscribeWebPushToken(token);
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(retirement).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
