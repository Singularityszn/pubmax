// Installed-web-app push registration seam. This module NEVER runs on boot and
// never asks permission by itself: a UI may call registerWebPush() only after a
// real user action, preserving the shared prompt budget and consent boundary.

import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { clearPublicWebPushRegistration } from "@/lib/webPushRegistrationState";

const WEB_PUSH_REGISTRATION_CEILING_MS = 10_000;
const WEB_PUSH_LOCAL_RETIRE_CEILING_MS = 3_000;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason
    ?? new DOMException("The web push registration was cancelled.", "AbortError");
}

function waitForWebPushWork<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function registrationScope(parentSignal?: AbortSignal): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const onParentAbort = () => {
    if (parentSignal) controller.abort(abortReason(parentSignal));
  };
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Web push registration timed out.", "TimeoutError"));
  }, WEB_PUSH_REGISTRATION_CEILING_MS);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer) : null;
  } catch {
    return null;
  }
}

async function boundedWebPushRetirement<T>(work: PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Web push retirement timed out.", "TimeoutError")),
    WEB_PUSH_LOCAL_RETIRE_CEILING_MS,
  );
  try {
    return await waitForWebPushWork(work, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

type CurrentWebSubscription =
  | { status: "none" }
  | { status: "active"; token: string }
  | { status: "unavailable" };

async function currentWebSubscriptionToken(): Promise<CurrentWebSubscription> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { status: "none" };
  }
  if (!("PushManager" in window)) return { status: "none" };
  try {
    const container = navigator.serviceWorker;
    const registration = typeof container.getRegistration === "function"
      ? await boundedWebPushRetirement(container.getRegistration())
      : await boundedWebPushRetirement(container.ready);
    if (!registration) return { status: "none" };
    const subscription = await boundedWebPushRetirement(
      registration.pushManager.getSubscription(),
    );
    if (!subscription) return { status: "none" };
    const token = encodeWebPushSubscription(subscription.toJSON());
    return token ? { status: "active", token } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/** Request permission, create/reuse a browser subscription and register it on
 * the identity-free push-token route. Returns the encoded token on success, or
 * null on any unsupported, denied, unconfigured or network-failed path. */
export async function registerWebPush(signal?: AbortSignal): Promise<string | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window) || !("Notification" in window)) return null;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const key = publicKey ? applicationServerKey(publicKey) : null;
  if (!key) {
    console.info(
      "[webPush] registration skipped: NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing or invalid.",
    );
    return null;
  }
  if (signal?.aborted) return null;

  try {
    const permission = Notification.permission === "default"
      ? signal
        ? await waitForWebPushWork(Notification.requestPermission(), signal)
        : await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") return null;

    const scope = registrationScope(signal);
    try {
      const registration = await waitForWebPushWork(
        navigator.serviceWorker.ready,
        scope.signal,
      );
      const currentSubscription = await waitForWebPushWork(
        registration.pushManager.getSubscription(),
        scope.signal,
      );
      const subscription = currentSubscription ?? await waitForWebPushWork(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }),
        scope.signal,
      );
      const token = encodeWebPushSubscription(subscription.toJSON());
      if (!token) return null;

      const response = await waitForWebPushWork(fetch("/api/push-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, platform: "web" }),
        signal: scope.signal,
      }), scope.signal);
      return response.ok ? token : null;
    } finally {
      scope.dispose();
    }
  } catch {
    return null;
  }
}

/** Unsubscribe the browser PushSubscription and ask the server to drop the
 * identity-free token row. Best-effort; never throws. */
export async function unregisterWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const subscription = await currentWebSubscriptionToken();
    if (subscription.status === "unavailable") return false;
    if (subscription.status === "none") {
      clearPublicWebPushRegistration();
      return true;
    }
    return unsubscribeWebPushToken(subscription.token);
  } catch {
    return false;
  }
}

/**
 * Make one exact subscription token physically undeliverable. A different or
 * absent current subscription proves the expected token is no longer active.
 * Server deletion remains best-effort because physical retirement is the
 * safety boundary for a bind request whose response may arrive late.
 */
export async function unsubscribeWebPushToken(
  expectedToken: string,
): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  try {
    const container = navigator.serviceWorker;
    const registration = typeof container.getRegistration === "function"
      ? await boundedWebPushRetirement(container.getRegistration())
      : await boundedWebPushRetirement(container.ready);
    if (!registration) {
      clearPublicWebPushRegistration(expectedToken);
      return true;
    }
    const subscription = await boundedWebPushRetirement(
      registration.pushManager.getSubscription(),
    );
    if (!subscription) {
      clearPublicWebPushRegistration(expectedToken);
      return true;
    }
    const currentToken = encodeWebPushSubscription(subscription.toJSON());
    if (!currentToken) return false;
    if (currentToken !== expectedToken) {
      clearPublicWebPushRegistration(expectedToken);
      return true;
    }
    await boundedWebPushRetirement(subscription.unsubscribe()).catch(() => undefined);
    const remaining = await boundedWebPushRetirement(
      registration.pushManager.getSubscription(),
    );
    if (remaining) {
      const remainingToken = encodeWebPushSubscription(remaining.toJSON());
      if (!remainingToken || remainingToken === expectedToken) return false;
    }
    clearPublicWebPushRegistration(expectedToken);
    void fetch("/api/push-tokens", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: expectedToken }),
    }).catch(() => null);
    return true;
  } catch {
    return false;
  }
}
