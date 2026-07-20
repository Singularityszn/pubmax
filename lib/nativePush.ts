// Native push-notification seam. Inside the Capacitor shell this asks for
// permission, registers with APNs, and POSTs the device token to
// /api/push-tokens (lib/pushTokenStore.ts). On the web / server every entry
// point is a no-op — callers can invoke registerNativePush() unconditionally.
// Like the other native seams, the plugin is imported dynamically so nothing
// Capacitor-shaped ever lands in the web bundle.

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";
import { rememberPushRegistration } from "@/lib/pushIdentityClient";

let nativeRecovery: Promise<boolean> | null = null;

async function postToken(token: string): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  try {
    const response = await fetch("/api/push-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, platform }),
    });
    if (response.ok) rememberPushRegistration({ token, platform });
  } catch {
    // Registration is best-effort; a failed POST just means no pushes yet.
  }
}

/**
 * Request permission and register for push inside the native shell.
 * Resolves true when a registration was kicked off, false when skipped
 * (web/SSR, permission denied, or plugin unavailable). Token delivery is
 * async — the `registration` listener POSTs it when APNs answers.
 */
export async function registerNativePush(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt") {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== "granted") return false;
    await PushNotifications.addListener("registration", (token) => {
      void postToken(token.value);
    });
    await PushNotifications.register();
    return true;
  } catch {
    return false;
  }
}

/** Re-emit an existing native token after a WebView/app restart, but ONLY when
 * OS permission is already granted. This never turns a sign-in or Plan view
 * into a surprise notification prompt. The registration callback persists the
 * anonymous row and wakes the verified identity join exactly as above. */
async function recoverExistingNativePushRegistration(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") return false;
    await PushNotifications.addListener("registration", (token) => {
      void postToken(token.value);
    });
    await PushNotifications.register();
    return true;
  } catch {
    return false;
  }
}

export function refreshExistingNativePushRegistration(): Promise<boolean> {
  // Account claim and Plan hydration can happen on the same render. Share one
  // APNs recovery attempt so they do not stack listeners or duplicate register.
  nativeRecovery ??= recoverExistingNativePushRegistration();
  return nativeRecovery;
}

/** Test-only: a WebView reload naturally resets this module state. */
export function __resetNativePushRecovery(): void {
  nativeRecovery = null;
}
