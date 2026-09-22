import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearPendingAccountPushBind,
  commitActiveAccountPushBind,
  markPendingAccountPushBind,
  retireAccountWebPush,
  withRetiredAccountWebPush,
  withVerifiedInitialAccountPushOwner,
  withVerifiedInitialSignedOutAccountPush,
  type AccountPushLifecycleDeps,
} from "@/lib/accountPushLifecycle";
import {
  markPublicWebPushToken,
  readPublicWebPushToken,
} from "@/lib/webPushRegistrationState";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const JSON_SUBSCRIPTION = {
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/account-boundary",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
};
const TOKEN = encodeWebPushSubscription(JSON_SUBSCRIPTION)!;
const PENDING_BIND = {
  version: 1 as const,
  revision: "bind-revision-a",
  ownerId: "account-a",
  subscriptionToken: TOKEN,
};
const NEWER_PENDING_BIND = {
  ...PENDING_BIND,
  revision: "bind-revision-b",
  subscriptionToken: `${TOKEN}-newer`,
};

afterEach(() => {
  clearPendingAccountPushBind(PENDING_BIND);
  clearPendingAccountPushBind(NEWER_PENDING_BIND);
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
    retirePendingToken: vi.fn(async () => false),
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
    expect(JSON.parse(String(init?.body))).toEqual({
      token: TOKEN,
      preservePublicToken: false,
    });
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
        retirePendingToken: async () => false,
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

  it("bounds an unsubscribe that never settles", async () => {
    vi.useFakeTimers();
    const outcome = retireAccountWebPush(
      "departing-access-token",
      deps({
        readSubscription: async () => subscription(
          () => new Promise<boolean>(() => undefined),
        ),
        detachAccountToken: async () => false,
      }),
    );

    await vi.advanceTimersByTimeAsync(3_000);
    await expect(outcome).resolves.toEqual({ status: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the account mutation behind successful retirement", async () => {
    const order: string[] = [];
    const outcome = await withRetiredAccountWebPush(
      "departing-access-token",
      async () => {
        order.push("session-change");
        return "changed";
      },
      deps({
        readSubscription: async () => {
          order.push("subscription-read");
          return subscription(async () => {
            order.push("unsubscribed");
            return true;
          });
        },
        detachAccountToken: async () => {
          order.push("server-detached");
          return true;
        },
      }),
    );

    expect(outcome).toMatchObject({ status: "completed", value: "changed" });
    expect(order.at(-1)).toBe("session-change");
  });

  it("does not mutate the account when retirement is unavailable", async () => {
    const continuation = vi.fn(async () => "changed");
    const outcome = await withRetiredAccountWebPush(
      "departing-access-token",
      continuation,
      deps({
        readSubscription: async () => subscription(async () => false),
        detachAccountToken: async () => false,
      }),
    );

    expect(outcome).toEqual({ status: "unavailable" });
    expect(continuation).not.toHaveBeenCalled();
  });

  it("requires physical unsubscribe while a bind response is uncertain", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    const continuation = vi.fn(async () => "changed");

    const blocked = await withRetiredAccountWebPush(
      "departing-access-token",
      continuation,
      deps({
        readSubscription: async () => subscription(async () => false),
        detachAccountToken: async () => true,
      }),
    );

    expect(blocked).toEqual({ status: "unavailable" });
    expect(continuation).not.toHaveBeenCalled();

    const completed = await withRetiredAccountWebPush(
      "departing-access-token",
      continuation,
      deps({
        readSubscription: async () => subscription(async () => true),
        detachAccountToken: async () => false,
        retirePendingToken: async () => true,
      }),
    );
    expect(completed).toMatchObject({ status: "completed", value: "changed" });
    expect(continuation).toHaveBeenCalledOnce();
  });

  it("does not let a stale completion clear a newer bind guard", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });

    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    expect(markPendingAccountPushBind(NEWER_PENDING_BIND)).toBe(true);
    clearPendingAccountPushBind(PENDING_BIND);

    expect([...values.values()]).toEqual([JSON.stringify(NEWER_PENDING_BIND)]);
  });

  it("retires a divergent current token as well as the pending token", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    const currentJson = {
      ...JSON_SUBSCRIPTION,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/current-newer",
    };
    const currentToken = encodeWebPushSubscription(currentJson)!;
    const continuation = vi.fn(async () => "changed");
    const detachAccountToken = vi.fn(async (token: string) => token === TOKEN);

    const outcome = await withRetiredAccountWebPush(
      "departing-access-token",
      continuation,
      deps({
        readSubscription: async () => ({
          toJSON: () => currentJson,
          unsubscribe: async () => false,
        }),
        detachAccountToken,
        retirePendingToken: async (token) => token === TOKEN,
      }),
    );

    expect(outcome).toEqual({ status: "unavailable" });
    expect(continuation).not.toHaveBeenCalled();
    expect(detachAccountToken).toHaveBeenCalledWith(
      TOKEN,
      "departing-access-token",
    );
    expect(detachAccountToken).toHaveBeenCalledWith(
      currentToken,
      "departing-access-token",
    );
  });

  it("preserves a cold-boot subscription only for its durable owner", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    expect(commitActiveAccountPushBind(PENDING_BIND)).toBe(true);
    clearPendingAccountPushBind(PENDING_BIND);
    const unsubscribe = vi.fn(async () => true);
    const continuation = vi.fn(async () => "published");

    const outcome = await withVerifiedInitialAccountPushOwner(
      "account-a",
      "account-a-access",
      continuation,
      deps({
        readSubscription: async () => subscription(unsubscribe),
      }),
    );

    expect(outcome).toMatchObject({ status: "completed", value: "published" });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(continuation).toHaveBeenCalledOnce();
  });

  it("retires legacy or differently-owned push before cold session publication", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    expect(commitActiveAccountPushBind(PENDING_BIND)).toBe(true);
    clearPendingAccountPushBind(PENDING_BIND);
    const unsubscribe = vi.fn(async () => true);
    const continuation = vi.fn(async () => "published");

    const outcome = await withVerifiedInitialAccountPushOwner(
      "account-b",
      "account-b-access",
      continuation,
      deps({
        readSubscription: async () => subscription(unsubscribe),
        detachAccountToken: async () => false,
      }),
    );

    expect(outcome).toMatchObject({ status: "completed", value: "published" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(continuation).toHaveBeenCalledOnce();
  });

  it("retires a stale subscription before cold signed-out publication", async () => {
    const unsubscribe = vi.fn(async () => true);
    const continuation = vi.fn(async () => "signed-out");

    const outcome = await withVerifiedInitialSignedOutAccountPush(
      continuation,
      deps({
        readSubscription: async () => subscription(unsubscribe),
      }),
    );

    expect(outcome).toMatchObject({ status: "completed", value: "signed-out" });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(continuation).toHaveBeenCalledOnce();
  });

  it.each([
    { ownerId: null, accessToken: null, value: "signed-out" },
    { ownerId: "account-b", accessToken: "account-b-access", value: "signed-in" },
  ])("preserves an exact identity-free subscription on cold boot for $value", async ({
    ownerId,
    accessToken,
    value,
  }) => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, stored: string) => values.set(key, stored),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    expect(markPublicWebPushToken(TOKEN)).toBe(true);
    const unsubscribe = vi.fn(async () => true);
    const detachAccountToken = vi.fn(async () => true);
    const continuation = vi.fn(async () => value);
    const lifecycleDeps = deps({
      readSubscription: async () => subscription(unsubscribe),
      detachAccountToken,
    });

    const outcome = ownerId && accessToken
      ? await withVerifiedInitialAccountPushOwner(
          ownerId,
          accessToken,
          continuation,
          lifecycleDeps,
        )
      : await withVerifiedInitialSignedOutAccountPush(
          continuation,
          lifecycleDeps,
        );

    expect(outcome).toMatchObject({ status: "completed", value });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(detachAccountToken).not.toHaveBeenCalled();
    expect(readPublicWebPushToken()).toEqual({
      status: "active",
      subscriptionToken: TOKEN,
    });
  });

  it("detaches personalized delivery while preserving the same public token", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, stored: string) => values.set(key, stored),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    expect(commitActiveAccountPushBind(PENDING_BIND)).toBe(true);
    clearPendingAccountPushBind(PENDING_BIND);
    expect(markPublicWebPushToken(TOKEN)).toBe(true);
    const detachAccountToken = vi.fn(async () => true);
    const unsubscribe = vi.fn(async () => true);

    const outcome = await withVerifiedInitialAccountPushOwner(
      "account-b",
      "account-b-access",
      async () => "published",
      deps({
        readSubscription: async () => subscription(unsubscribe),
        detachAccountToken,
      }),
    );

    expect(outcome).toMatchObject({ status: "completed", value: "published" });
    expect(detachAccountToken).toHaveBeenCalledWith(TOKEN, "account-b-access");
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(readPublicWebPushToken()).toEqual({
      status: "active",
      subscriptionToken: TOKEN,
    });
  });

  it("retires an uncertain pending token without unsubscribing a different public token", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, stored: string) => values.set(key, stored),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    expect(markPendingAccountPushBind(PENDING_BIND)).toBe(true);
    const currentJson = {
      ...JSON_SUBSCRIPTION,
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/public-current",
    };
    const currentToken = encodeWebPushSubscription(currentJson)!;
    expect(markPublicWebPushToken(currentToken)).toBe(true);
    const unsubscribe = vi.fn(async () => true);
    const retirePendingToken = vi.fn(async (token: string) => token === TOKEN);
    const detachAccountToken = vi.fn(async () => true);

    const outcome = await withRetiredAccountWebPush(
      "departing-access-token",
      async () => "changed",
      deps({
        readSubscription: async () => ({
          toJSON: () => currentJson,
          unsubscribe,
        }),
        detachAccountToken,
        retirePendingToken,
      }),
    );

    expect(outcome).toMatchObject({ status: "completed", value: "changed" });
    expect(retirePendingToken).toHaveBeenCalledWith(TOKEN);
    expect(detachAccountToken).toHaveBeenCalledWith(
      currentToken,
      "departing-access-token",
    );
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(readPublicWebPushToken()).toEqual({
      status: "active",
      subscriptionToken: currentToken,
    });
  });
});
