// Native push-notification seam. Inside the Capacitor shell this asks for
// permission, registers with APNs, and POSTs the device token to
// /api/push-tokens (lib/pushTokenStore.ts). On the web / server every entry
// point is a no-op — callers can invoke registerNativePush() unconditionally.
// Like the other native seams, the plugin is imported dynamically so nothing
// Capacitor-shaped ever lands in the web bundle.

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";
import { navigateNativeBrowser } from "@/lib/nativeNavigation";

const APP_ORIGIN = "https://pubmaxxing.com";
const PUSH_PATHS = ["/tonight"] as const;
const PUSH_PATH_PREFIXES = ["/plan/"] as const;

type NativePushNotification = {
  data?: Record<string, unknown>;
};

/** Android registration stays off until pushSender can route tokens to FCM. */
export function nativePushRegistrationSupported(): boolean {
  return nativePlatform() === "ios";
}

/** Convert a server-owned notification target to a safe internal app path. */
export function nativePushNavigationPath(
  notification: NativePushNotification,
): string | null {
  const rawPath = notification.data?.url;
  if (typeof rawPath !== "string" || !rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(rawPath, APP_ORIGIN);
    if (url.origin !== APP_ORIGIN) return null;
    const allowed =
      PUSH_PATHS.some((path) => url.pathname === path) ||
      PUSH_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    if (!allowed) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

async function postToken(token: string): Promise<void> {
  const platform = nativePlatform();
  if (!platform) return;
  try {
    await fetch("/api/push-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, platform }),
    });
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
  if (!isNativeApp() || !nativePushRegistrationSupported()) return false;
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

/**
 * Route native notification taps. This listener attaches at shell boot, not
 * when permission is requested, so cold and warm taps work in later sessions.
 */
export async function activateNativePushNavigation(
  navigate: (path: string) => void = navigateNativeBrowser,
): Promise<() => void> {
  if (!isNativeApp()) return () => {};

  let removeListener: (() => Promise<void>) | undefined;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const listener = await PushNotifications.addListener(
      "pushNotificationActionPerformed",
      ({ notification }) => {
        const path = nativePushNavigationPath(notification);
        if (path) navigate(path);
      },
    );
    removeListener = () => listener.remove();
    return () => {
      void removeListener?.();
      removeListener = undefined;
    };
  } catch {
    void removeListener?.();
    return () => {};
  }
}
