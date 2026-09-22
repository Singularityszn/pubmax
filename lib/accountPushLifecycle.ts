"use client";

// Retire the installed browser's account-linked web push before an auth
// boundary. Server detachment and local unsubscribe are independent safety
// paths: either one prevents the departing account's personalized payload from
// reaching the browser. If neither succeeds, the account boundary stays put.

import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const SUBSCRIPTION_READ_TIMEOUT_MS = 2_000;
const SERVER_DETACH_TIMEOUT_MS = 5_000;

type AccountPushSubscription = Pick<PushSubscription, "toJSON" | "unsubscribe">;

export type AccountPushLifecycleDeps = {
  readSubscription: () => Promise<AccountPushSubscription | null>;
  detachAccountToken: (
    subscriptionToken: string,
    accessToken: string,
  ) => Promise<boolean>;
};

export type AccountPushRetirementOutcome =
  | { status: "not_registered" }
  | {
      status: "retired";
      serverDetached: boolean;
      unsubscribed: boolean;
    }
  | { status: "unavailable" };

async function attempt(action: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await action()) === true;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out.")), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readBrowserSubscription(): Promise<AccountPushSubscription | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;
  const container = navigator.serviceWorker;
  const registration = typeof container.getRegistration === "function"
    ? await withTimeout(container.getRegistration(), SUBSCRIPTION_READ_TIMEOUT_MS)
    : await withTimeout(container.ready, SUBSCRIPTION_READ_TIMEOUT_MS);
  if (!registration) return null;
  return withTimeout(
    registration.pushManager.getSubscription(),
    SUBSCRIPTION_READ_TIMEOUT_MS,
  );
}

async function detachBrowserToken(
  subscriptionToken: string,
  accessToken: string,
): Promise<boolean> {
  if (!accessToken) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_DETACH_TIMEOUT_MS);
  try {
    const response = await fetch("/api/push-tokens/account", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: subscriptionToken }),
      cache: "no-store",
      keepalive: true,
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function browserAccountPushLifecycleDeps(): AccountPushLifecycleDeps {
  return {
    readSubscription: readBrowserSubscription,
    detachAccountToken: detachBrowserToken,
  };
}

/**
 * Retire the current browser subscription before sign-out or account switch.
 * A successful local unsubscribe is safe while offline. A successful server
 * detach is safe when the browser refuses to unsubscribe. Only dual failure
 * blocks the account boundary.
 */
export async function retireAccountWebPush(
  accessToken: string | null | undefined,
  deps: AccountPushLifecycleDeps = browserAccountPushLifecycleDeps(),
): Promise<AccountPushRetirementOutcome> {
  let subscription: AccountPushSubscription | null;
  try {
    subscription = await deps.readSubscription();
  } catch {
    return { status: "unavailable" };
  }
  if (!subscription) return { status: "not_registered" };

  let subscriptionToken: string | null = null;
  try {
    subscriptionToken = encodeWebPushSubscription(subscription.toJSON());
  } catch {
    // A malformed serialization cannot name the server row, but a successful
    // local unsubscribe still makes the account boundary safe.
  }
  const [serverDetached, unsubscribed] = await Promise.all([
    subscriptionToken && accessToken
      ? attempt(() => deps.detachAccountToken(subscriptionToken, accessToken))
      : Promise.resolve(false),
    attempt(() => subscription.unsubscribe()),
  ]);

  if (!serverDetached && !unsubscribed) return { status: "unavailable" };
  return { status: "retired", serverDetached, unsubscribed };
}
