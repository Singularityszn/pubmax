// Native share seam. The Web Share API is NOT implemented in the Android
// System WebView, so inside the Android shell `navigator.share` is simply
// absent and every share in the app fell through to opening a wa.me link -
// including a shared plan, a shared pub and a shared night, which are the
// app's growth loops. @capacitor/share is the only route to the OS picker
// there, which is why the dependency exists and why this is the one module
// that touches it (the lib/nativeHaptics.ts idiom: one seam, dynamic import,
// gated on isNativeApp(), so no Capacitor-shaped module lands in the web
// bundle).
//
// Three rules ride with it.
//
// 1. THE WEB IS UNTOUCHED. Off the shell this answers "unavailable" and sends
//    nothing, so lib/shareSheet.ts keeps navigator.share first and the wa.me
//    fallback behind it exactly as before.
// 2. A CANCEL IS NOT A FAILURE. iOS rejects a dismissed sheet with the plugin
//    message "Share canceled" rather than an AbortError, so the web
//    isUserCancelledShare() check cannot read it. A dismissal must never force
//    a WhatsApp tab open behind the sheet the person just closed.
// 3. IT NEVER GATES THE SHARE. A missing plugin, an older shell, a refused
//    sheet: every one answers "unavailable" and the caller carries on down the
//    existing path.

import { isNativeApp } from "@/lib/nativePlatform";

export type NativeShareInput = {
  title: string;
  text: string;
  /** Absolute URL - callers resolve relative paths against their origin first. */
  url: string;
};

export type NativeShareOutcome =
  /** The OS picker opened and the person picked an app. */
  | "shared"
  /** The person dismissed the sheet. Do nothing loud, and do not fall back. */
  | "cancelled"
  /** No shell, no plugin, or the sheet could not open: the caller's own path stands. */
  | "unavailable";

/**
 * Whether a dismissed native sheet is what an error describes. The iOS plugin
 * rejects with the literal message below; Android resolves on dismissal and
 * never reaches here. Pure, and exported so the contract is readable.
 */
export function isNativeShareCancellation(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message)
      : typeof error === "string"
        ? error
        : "";
  return /share\s+cancell?ed/i.test(message);
}

/** The single plugin call this seam makes. Nothing wider is needed or used. */
type NativeSharePlugin = {
  share: (options: {
    title?: string;
    text?: string;
    url?: string;
    dialogTitle?: string;
  }) => Promise<unknown>;
};

export type NativeShareDeps = {
  /** Defaults to the canonical shell probe. */
  isNative?: () => boolean;
  /** Defaults to the dynamic @capacitor/share import. */
  loadPlugin?: () => Promise<NativeSharePlugin>;
};

// A CAPACITOR PLUGIN IS A PROXY, AND IT ANSWERS "then" WITH A NATIVE CALL.
// registerPlugin() hands back a Proxy whose every property is a method on the
// native side, so returning it from an async function makes the await look
// for a thenable, call the native "Share.then()", and reject with
// '"Share.then()" is not implemented' (measured on the Pixel 7 emulator through
// the WebView's console: docs/proof/mobile-app-design/android-emu-pixel7/share/).
// The loader hands back a plain object that closes over the plugin instead.
// __tests__/capacitorPluginProxy.test.ts holds every loader to this with a
// proxy shaped like the real one.
async function loadSharePlugin(): Promise<NativeSharePlugin> {
  const { Share } = await import("@capacitor/share");
  return { share: (options) => Share.share(options) };
}

/**
 * Open the OS share sheet inside the native shell. Resolves "unavailable" off
 * the shell and on every failure, so a caller may try this first and keep its
 * own fallback untouched behind it.
 */
export async function shareViaNativeSheet(
  input: NativeShareInput,
  deps: NativeShareDeps = {},
): Promise<NativeShareOutcome> {
  const isNative = deps.isNative ?? isNativeApp;
  if (!isNative()) return "unavailable";

  let plugin: NativeSharePlugin;
  try {
    plugin = await (deps.loadPlugin ?? loadSharePlugin)();
  } catch {
    // An older shell built before the plugin landed. The caller's own path
    // still works.
    return "unavailable";
  }

  try {
    await plugin.share({
      title: input.title,
      text: input.text,
      url: input.url,
      // Android's chooser titles itself; the app's own title is the honest one.
      dialogTitle: input.title,
    });
    return "shared";
  } catch (error) {
    if (isNativeShareCancellation(error)) return "cancelled";
    return "unavailable";
  }
}
