// The Web Share API inside the Android shell.
//
// `navigator.share` is not implemented in the Android System WebView, and nine
// surfaces call it directly (the Tonight share, the recap and plan share
// bars, the last-train card, the safe-night strip, the account hub's referral
// link, the add-me link, the family ledger). lib/nativeShare.ts is the seam
// that asks the OS picker first, and lib/shareSheet.ts routes the night
// objects through it, but every direct caller still read `navigator.share`
// as absent inside the shell and took its own fallback: the Tonight button
// copied a link to the clipboard in silence and, on a cleartext origin, said
// "Could not share tonight" (docs/proof/mobile-app-design/android-emu-pixel7/
// share/). iOS never saw it, because WKWebView ships the API.
//
// So the shell supplies the API where the WebView does not: one definition of
// `navigator.share` over the Capacitor Share plugin, installed by
// components/native/NativeShellChrome.tsx after the canonical `isNativeApp()`
// probe. Every existing caller then gets the OS picker with no change, and a
// dismissed sheet rejects with the same AbortError the web throws, so the
// caller's own cancel handling keeps working. A WebView that has the API
// keeps it: this is a fill, never an override.

import { isNativeApp } from "@/lib/nativePlatform";
import {
  shareViaNativeSheet,
  type NativeShareInput,
  type NativeShareOutcome,
} from "@/lib/nativeShare";

type ShareInput = { title?: string; text?: string; url?: string };

export type NativeWebShareBridgeDeps = {
  /** Defaults to the canonical shell probe. */
  isNative?: () => boolean;
  /** Defaults to the real navigator. */
  nav?: Navigator | { share?: unknown; canShare?: unknown };
  /** Defaults to the native share seam. */
  shareNatively?: (input: NativeShareInput) => Promise<NativeShareOutcome>;
};

/** Whether a share payload has anything the OS picker can carry. */
export function webShareDataIsShareable(data: ShareInput | null | undefined): boolean {
  if (!data || typeof data !== "object") return false;
  return [data.title, data.text, data.url].some((value) => typeof value === "string" && value.length > 0);
}

function abortError(): Error {
  // The Web Share API rejects a dismissed sheet with AbortError, which is
  // what lib/venueShare.ts and every direct caller already test for.
  try {
    return new DOMException("Share canceled", "AbortError");
  } catch {
    const error = new Error("Share canceled");
    error.name = "AbortError";
    return error;
  }
}

/**
 * Install `navigator.share` over the native sheet where the WebView has none.
 * Returns the uninstaller. A no-op off the shell and wherever the API exists.
 */
export function installNativeWebShareBridge(deps: NativeWebShareBridgeDeps = {}): () => void {
  const isNative = deps.isNative ?? isNativeApp;
  if (!isNative()) return () => {};
  const nav = (deps.nav ?? (typeof navigator === "undefined" ? undefined : navigator)) as
    | (Navigator & { share?: unknown; canShare?: unknown })
    | undefined;
  if (!nav || typeof nav.share === "function") return () => {};
  const shareNatively = deps.shareNatively ?? ((input: NativeShareInput) => shareViaNativeSheet(input));

  const share = async (data?: ShareInput): Promise<void> => {
    if (!webShareDataIsShareable(data)) {
      throw new TypeError("Share data must carry a title, text or url.");
    }
    // The native seam names the sheet after the title; the Web Share API
    // makes every field optional, so an absent title is an empty one.
    const outcome = await shareNatively({
      title: data?.title ?? "",
      text: data?.text ?? "",
      url: data?.url ?? "",
    });
    if (outcome === "shared") return;
    if (outcome === "cancelled") throw abortError();
    throw new Error("Share unavailable");
  };
  const canShare = (data?: ShareInput): boolean => webShareDataIsShareable(data);

  try {
    Object.defineProperty(nav, "share", { configurable: true, writable: true, value: share });
    Object.defineProperty(nav, "canShare", { configurable: true, writable: true, value: canShare });
  } catch {
    return () => {};
  }
  return () => {
    try {
      if (nav.share === share) delete (nav as { share?: unknown }).share;
      if (nav.canShare === canShare) delete (nav as { canShare?: unknown }).canShare;
    } catch {
      // A frozen navigator keeps the fill; nothing else to release.
    }
  };
}
