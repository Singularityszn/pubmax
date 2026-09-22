import { afterEach, describe, expect, it, vi } from "vitest";

import {
  retireAccountWebPush,
  type AccountPushLifecycleDeps,
} from "@/lib/accountPushLifecycle";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const JSON_SUBSCRIPTION = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/account-boundary",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
};
const TOKEN = encodeWebPushSubscription(JSON_SUBSCRIPTION)!;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function subscription(unsubscribe: () => Promise<boolean>) {
  return {
    toJSON: () => JSON_SUBSCRIPTION,
    unsubscribe,
  };
}

function deps(
  overrides: Partial<AccountPushLifecycleDeps> = {},
): AccountPushLifecycleDeps {
  return {
    readSubscription: vi.fn(async () => null),
    detachAccountToken: vi.fn(async () => false),
    ...overrides,
  };
}

describe("account web-push retirement", () => {
  it("uses the installed subscription without requiring VAPID configuration", async () => {
    const unsubscribe = vi.fn(async () => true);
    const getSubscription = vi.fn(async () => subscription(unsubscribe));
    const getRegistration = vi.fn(async () => ({ pushManager: { getSubscription } }));
    vi.stubGlobal("window", { PushManager: class {} });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await retireAccountWebPush("departing-access-token");

    expect(outcome).toEqual({
      status: "retired",
      serverDetached: true,
      unsubscribed: true,
    });
    expect(getRegistration).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/push-tokens/account");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer departing-access-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({ token: TOKEN });
  });

  it("bounds an unreadable service-worker registration before blocking", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { PushManager: class {} });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: () => new Promise<ServiceWorkerRegistration>(() => undefined),
      },
    });

    const retirement = retireAccountWebPush("departing-access-token");
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(retirement).resolves.toEqual({ status: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing when this browser has no subscription", async () => {
    const detachAccountToken = vi.fn(async () => true);
    const outcome = await retireAccountWebPush("access-token", deps({ detachAccountToken }));

    expect(outcome).toEqual({ status: "not_registered" });
    expect(detachAccountToken).not.toHaveBeenCalled();
  });

  it("retires through both server detachment and local unsubscribe", async () => {
    const unsubscribe = vi.fn(async () => true);
    const detachAccountToken = vi.fn(async () => true);

    const outcome = await retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => subscription(unsubscribe),
        detachAccountToken,
      }),
    );

    expect(outcome).toEqual({
      status: "retired",
      serverDetached: true,
      unsubscribed: true,
    });
    expect(detachAccountToken).toHaveBeenCalledWith(
      TOKEN,
      "departing-access-token",
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("permits the boundary when local unsubscribe succeeds offline", async () => {
    const outcome = await retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => subscription(async () => true),
        detachAccountToken: async () => false,
      }),
    );

    expect(outcome).toEqual({
      status: "retired",
      serverDetached: false,
      unsubscribed: true,
    });
  });

  it("permits the boundary when server detachment succeeds but unsubscribe fails", async () => {
    const outcome = await retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => subscription(async () => false),
        detachAccountToken: async () => true,
      }),
    );

    expect(outcome).toEqual({
      status: "retired",
      serverDetached: true,
      unsubscribed: false,
    });
  });

  it("blocks the account boundary when neither retirement path succeeds", async () => {
    const outcome = await retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => subscription(async () => {
          throw new Error("unsubscribe failed");
        }),
        detachAccountToken: async () => {
          throw new Error("offline");
        },
      }),
    );

    expect(outcome).toEqual({ status: "unavailable" });
  });

  it("still unsubscribes when a browser returns malformed subscription JSON", async () => {
    const unsubscribe = vi.fn(async () => true);
    const outcome = await retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => ({
          toJSON: () => {
            throw new Error("broken serialization");
          },
          unsubscribe,
        }),
      }),
    );

    expect(outcome).toEqual({
      status: "retired",
      serverDetached: false,
      unsubscribed: true,
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("blocks when subscription state cannot be read safely", async () => {
    const outcome = await retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => {
          throw new Error("service worker unavailable");
        },
      }),
    );

    expect(outcome).toEqual({ status: "unavailable" });
  });
});
