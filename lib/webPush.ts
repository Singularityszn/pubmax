// Installed-web-app push registration seam. This module NEVER runs on boot and
// never asks permission by itself: a UI may call registerWebPush() only after a
// real user action, preserving the shared prompt budget and consent boundary.

import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { rememberPushRegistration } from "@/lib/pushIdentityClient";
import { pushInstallationId } from "@/lib/pushInstallation";
import { pushFetch, withPushTimeout } from "@/lib/pushTimeout";

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

/** Request permission, create/reuse a browser subscription and register it on
 * the identity-free push-token route. Returns false on any unsupported,
 * denied, unconfigured or network-failed path; it never throws. */
export async function registerWebPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window) || !("Notification" in window)) return false;
  const installationId = pushInstallationId();

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const key = publicKey ? applicationServerKey(publicKey) : null;
  if (!key) {
    console.info(
      "[webPush] registration skipped: NEXT_PUBLIC_VAPID_PUBLIC_KEY is missing or invalid.",
    );
    return false;
  }

  try {
    const permission = Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted") return false;

    const registration = await withPushTimeout(navigator.serviceWorker.ready);
    const subscription = await registration.pushManager.getSubscription()
      ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    const token = encodeWebPushSubscription(subscription.toJSON());
    if (!token) return false;

    const response = await pushFetch("/api/push-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, platform: "web", installationId }),
    });
    if (response.ok) rememberPushRegistration({ token, platform: "web" });
    return response.ok;
  } catch {
    return false;
  }
}
