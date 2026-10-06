import { afterEach, describe, expect, it, vi } from "vitest";

import { registerWebPush } from "@/lib/webPush";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type BrowserHarnessOptions = Readonly<{
  requestPermission?: () => Promise<NotificationPermission>;
  ready?: Promise<Pick<ServiceWorkerRegistration, "pushManager">>;
  subscribe?: () => Promise<PushSubscription>;
  fetch?: typeof globalThis.fetch;
}>;

function browserHarness(options: BrowserHarnessOptions = {}) {
  const requestPermission = vi.fn(
    options.requestPermission ?? (async () => "granted" as NotificationPermission),
  );
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
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
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
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
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

  it("does not count a slow permission grant against the registration deadline", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    let grant!: (permission: NotificationPermission) => void;
    const { fetch } = browserHarness({
      requestPermission: () => new Promise<NotificationPermission>((resolve) => {
        grant = resolve;
      }),
    });

    const registration = registerWebPush();
    await flushRegistrationMicrotasks();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(15_000);
    grant("granted");

    await expect(registration).resolves.toMatch(/^webpush:/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the caller cancel a pending permission prompt", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "A".repeat(87));
    const { fetch } = browserHarness({
      requestPermission: () => new Promise<NotificationPermission>(() => undefined),
    });
    const controller = new AbortController();

    const registration = registerWebPush(controller.signal);
    await flushRegistrationMicrotasks();
    controller.abort();

    await expect(registration).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
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
