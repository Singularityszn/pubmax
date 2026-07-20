// Native push-notification seam. Inside the Capacitor shell this asks for
// permission, registers with APNs, and POSTs the device token to
// /api/push-tokens (lib/pushTokenStore.ts). On the web / server every entry
// point is a no-op — callers can invoke registerNativePush() unconditionally.
// Like the other native seams, the plugin is imported dynamically so nothing
// Capacitor-shaped ever lands in the web bundle.

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";
import { rememberPushRegistration, type ClientPushRegistration } from "@/lib/pushIdentityClient";

export type NativePushRecoveryResult =
  | { status: "registration"; registration: ClientPushRegistration }
  | { status: "not_native" | "not_permitted" | "failed" };

let nativeRecovery: Promise<NativePushRecoveryResult> | null = null;

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
async function recoverExistingNativePushRegistration(): Promise<NativePushRecoveryResult> {
  if (!isNativeApp()) return { status: "not_native" };
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const permission = await PushNotifications.checkPermissions();
    if (permission.receive !== "granted") return { status: "not_permitted" };
    const platform = nativePlatform();
    if (!platform) return { status: "failed" };

    return await new Promise<NativePushRecoveryResult>(async (resolve) => {
      let settled = false;
      let registrationListener: { remove: () => Promise<void> } | null = null;
      let errorListener: { remove: () => Promise<void> } | null = null;
      const finish = (result: NativePushRecoveryResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void registrationListener?.remove();
        void errorListener?.remove();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ status: "failed" }), 4_000);
      try {
        registrationListener = await PushNotifications.addListener("registration", (token) => {
          const registration = { token: token.value, platform } satisfies ClientPushRegistration;
          // Make the exact OS-issued token available immediately. Anonymous
          // refresh is independent; logout's authenticated DELETE must not wait
          // on or be replaced by that best-effort write.
          rememberPushRegistration(registration);
          void postToken(token.value);
          finish({ status: "registration", registration });
        });
        errorListener = await PushNotifications.addListener("registrationError", () => {
          finish({ status: "failed" });
        });
        await PushNotifications.register();
      } catch {
        finish({ status: "failed" });
      }
    });
  } catch {
    return { status: "failed" };
  }
}

export function recoverNativePushRegistration(): Promise<NativePushRecoveryResult> {
  // Account claim and Plan hydration can happen on the same render. Share one
  // APNs recovery attempt so they do not stack listeners or duplicate register.
  if (!nativeRecovery) {
    nativeRecovery = recoverExistingNativePushRegistration().then((result) => {
      if (result.status !== "registration") nativeRecovery = null;
      return result;
    });
  }
  return nativeRecovery;
}

export async function refreshExistingNativePushRegistration(): Promise<boolean> {
  return (await recoverNativePushRegistration()).status === "registration";
}

/** Test-only: a WebView reload naturally resets this module state. */
export function __resetNativePushRecovery(): void {
  nativeRecovery = null;
}
