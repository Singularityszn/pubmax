// The OS text size inside the native shell.
//
// A person who has turned their phone's text up expects an app to follow.
// The Android WebView does it by itself: the OS font scale is applied to
// every page as a text zoom, so at "Largest" (2.0x) the app already reads
// twice as large. The WKWebView does nothing: Dynamic Type reaches only text
// set in the `-apple-system-body` family, and this app's type is in CSS px, so
// iOS's Larger Text setting had no effect at all (measured at the largest
// accessibility size on the iPhone 17 Pro simulator:
// docs/proof/mobile-app-design/ios-sim-iphone17pro/textscale/).
//
// @capacitor/text-zoom is the seam. On iOS `getPreferred()` answers the ratio
// of the preferred body font to WebKit's 17pt base, and `set()` writes
// `-webkit-text-size-adjust` on the body, which WebKit honours for every
// text node. On Android `get()` reads the zoom the WebView already applies.
// Either way the effective scale is published on <html> as
// `data-text-scale`, so a surface that cannot grow (the six-tab bar) can
// change shape the way a native tab bar does at large sizes rather than
// overflow (docs/proof/mobile-app-design/android-emu-pixel7/textscale/).
//
// The iOS scale is CLAMPED to what Android's own ceiling is, 2.0: the
// accessibility sizes run to 3.1x body, and a page laid out for a phone
// cannot honestly hold that, while 2.0 is the largest size either OS ships in
// its ordinary slider. Off the shell every function here is a no-op.
//
// The plugin loader hands back a plain object rather than the plugin proxy:
// see the note in lib/nativeShare.ts and __tests__/capacitorPluginProxy.test.ts.

import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";

/** The attribute a stylesheet reads to change shape under a large text size. */
export const TEXT_SCALE_ATTRIBUTE = "data-text-scale";

/** From this scale up the six-tab bar shows icons alone, as a native bar does. */
export const LARGE_TEXT_SCALE_FLOOR = 1.3;

/** The largest scale the shell asks WebKit for; Android's own ceiling. */
export const MAX_TEXT_SCALE = 2;

export type TextScaleBucket = "large" | null;

/** The shape a stylesheet should take at this scale. */
export function textScaleBucket(scale: number): TextScaleBucket {
  return Number.isFinite(scale) && scale >= LARGE_TEXT_SCALE_FLOOR ? "large" : null;
}

/** What the shell asks WebKit for: never below 1, never above Android's ceiling. */
export function clampTextScale(preferred: number): number {
  if (!Number.isFinite(preferred)) return 1;
  return Math.min(MAX_TEXT_SCALE, Math.max(1, preferred));
}

type TextZoomPlugin = {
  get: () => Promise<{ value: number }>;
  getPreferred: () => Promise<{ value: number }>;
  set: (options: { value: number }) => Promise<void>;
};

export type NativeTextScaleDeps = {
  isNative?: () => boolean;
  platform?: () => "ios" | "android" | null;
  loadPlugin?: () => Promise<TextZoomPlugin>;
  root?: HTMLElement | null;
};

async function loadTextZoomPlugin(): Promise<TextZoomPlugin> {
  const { TextZoom } = await import("@capacitor/text-zoom");
  return {
    get: () => TextZoom.get(),
    getPreferred: () => TextZoom.getPreferred(),
    set: (options) => TextZoom.set(options),
  };
}

export type NativeTextScaleOutcome =
  | { status: "applied"; scale: number }
  | { status: "read"; scale: number }
  | { status: "unavailable" };

/**
 * Bring the document to the OS text size (iOS) or read the one the WebView
 * already applied (Android), and publish the bucket on <html>. Never throws.
 */
export async function applyNativeTextScale(
  deps: NativeTextScaleDeps = {},
): Promise<NativeTextScaleOutcome> {
  const isNative = deps.isNative ?? isNativeApp;
  if (!isNative()) return { status: "unavailable" };
  const platform = (deps.platform ?? nativePlatform)();
  let plugin: TextZoomPlugin;
  try {
    plugin = await (deps.loadPlugin ?? loadTextZoomPlugin)();
  } catch {
    return { status: "unavailable" };
  }
  const root =
    deps.root ?? (typeof document === "undefined" ? null : document.documentElement);
  const publish = (scale: number) => {
    if (!root) return;
    const bucket = textScaleBucket(scale);
    if (bucket) root.setAttribute(TEXT_SCALE_ATTRIBUTE, bucket);
    else root.removeAttribute(TEXT_SCALE_ATTRIBUTE);
  };
  try {
    if (platform === "ios") {
      const { value } = await plugin.getPreferred();
      const scale = clampTextScale(value);
      await plugin.set({ value: scale });
      publish(scale);
      return { status: "applied", scale };
    }
    const { value } = await plugin.get();
    const scale = Number.isFinite(value) && value > 0 ? value : 1;
    publish(scale);
    return { status: "read", scale };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Apply now and again whenever the app comes back to the foreground, which is
 * when a person returns from the Settings app having changed the size. Returns
 * the release.
 */
export function followNativeTextScale(deps: NativeTextScaleDeps = {}): () => void {
  const isNative = deps.isNative ?? isNativeApp;
  if (!isNative() || typeof document === "undefined") return () => {};
  void applyNativeTextScale(deps);
  const onVisible = () => {
    if (document.visibilityState === "visible") void applyNativeTextScale(deps);
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
