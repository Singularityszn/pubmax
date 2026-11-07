// Installed-web-app push registration seam. This module NEVER runs on boot and
// never asks permission by itself: a UI may call registerWebPush() only after a
// real user action, preserving the shared prompt budget and consent boundary.

import { abortReason } from "@/lib/abortableDelay";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const WEB_PUSH_REGISTRATION_CEILING_MS = 10_000;

function webPushAbortReason(signal: AbortSignal): unknown {
  return abortReason(signal, "The web push registration was cancelled.");
}

/** Race browser work against a signal, so a promise that never settles (a service
 * worker that never becomes ready) cannot hold a prompt open for ever. */
function waitForWebPushWork<T>(work: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(work);
  if (signal.aborted) return Promise.reject(webPushAbortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(webPushAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** A signal that aborts on the caller's signal or the registration deadline.
 * dispose() clears the timer and the listener once the step settles. */
function registrationScope(parentSignal?: AbortSignal): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const onParentAbort = () => {
    if (parentSignal) controller.abort(webPushAbortReason(parentSignal));
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

export type WebPushSupport = "supported" | "unsupported" | "blocked";

/**
 * Whether THIS browser can be asked for web push at all, without asking. A
 * surface reads it before a person presses the switch, so "this browser cannot"
 * and "you blocked it" are two sentences rather than one vague failure.
 * `blocked` is the permission the person (or the browser) already denied: the
 * prompt will never open again, so only the site settings can undo it.
 */
export function webPushSupport(): WebPushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission === "denied" ? "blocked" : "supported";
}

/** Request permission, create/reuse a browser subscription and register it on
 * the identity-free push-token route. Returns the encoded token on success, or
 * null on any unsupported, denied, unconfigured or network-failed path. */
export async function registerWebPush(
  signal?: AbortSignal,
  onSlowSubscription?: () => void,
): Promise<string | null> {
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

  // The person's time on the permission dialog is theirs: only the caller can
  // cancel it. Native subscription setup also waits for the caller. The other
  // steps use the registration deadline, which every exit path disposes.
  let scope: ReturnType<typeof registrationScope> | null = null;
  const disposeStep = () => {
    scope?.dispose();
    scope = null;
  };
  const step = () => {
    disposeStep();
    scope = registrationScope(signal);
    return scope.signal;
  };
  try {
    const permission = Notification.permission === "default"
      ? await waitForWebPushWork(Notification.requestPermission(), signal)
      : Notification.permission;
    if (permission !== "granted") return null;

    const ready = step();
    const registration = await waitForWebPushWork(navigator.serviceWorker.ready, ready);
    let subscription = await waitForWebPushWork(
      registration.pushManager.getSubscription(),
      ready,
    );
    disposeStep();
    if (!subscription) {
      // Fresh-profile endpoint setup can exceed a minute. Only the caller
      // cancels this wait. The token request still has its own deadline.
      const pendingNotice = setTimeout(() => {
        if (!signal?.aborted) onSlowSubscription?.();
      }, 60_000);
      try {
        subscription = await waitForWebPushWork(
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          }),
          signal,
        );
      } finally {
        clearTimeout(pendingNotice);
      }
    }
    const token = encodeWebPushSubscription(subscription.toJSON());
    if (!token) return null;

    const request = step();
    const response = await waitForWebPushWork(
      fetch("/api/push-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, platform: "web" }),
        signal: request,
      }),
      request,
    );
    return response.ok ? token : null;
  } catch {
    return null;
  } finally {
    disposeStep();
  }
}
