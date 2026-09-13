// The launch splash inside the native shell.
//
// The shell is a remote-URL wrap, so between the launch screen and the first
// painted page there is a network wait nothing native covers. On 13 September
// 2026 a clean install against production waited 20 seconds for its first
// document on the pubmaxx-390x844 simulator, and every frame of it was the
// bare ink field: UILaunchScreen goes with the first native frame, whatever
// the WebView is still doing.
//
// @capacitor/splash-screen holds the mark instead. capacitor.config.ts keeps
// its auto-hide ON at NATIVE_SPLASH_CEILING_MS, which is the ceiling: a phone
// with no route to the origin still reaches the bundled offline page, and that
// page releases the splash itself. This seam is the SOONER release. Once the
// shell chrome has mounted it waits for a frame the page has painted in,
// announces `pubmax:first-paint` and hides the splash, once per document.
//
// Off the shell it is a no-op, and the plugin loader hands back a plain object
// rather than the plugin proxy: see __tests__/capacitorPluginProxy.test.ts.

import { isNativeApp } from "@/lib/nativePlatform";

/** Announced on window once the page has painted inside the shell. */
export const NATIVE_FIRST_PAINT_EVENT = "pubmax:first-paint";

/**
 * The longest the splash may stand, whatever the page does. The same figure is
 * `plugins.SplashScreen.launchShowDuration` in capacitor.config.ts, which the
 * CLI reads without this module's imports; __tests__/nativeSplash.test.ts holds
 * the two equal.
 */
export const NATIVE_SPLASH_CEILING_MS = 12_000;

type SplashPlugin = {
  hide: () => Promise<void>;
};

export type NativeSplashDeps = {
  isNative?: () => boolean;
  loadPlugin?: () => Promise<SplashPlugin>;
  /** Calls back once the browser has painted a frame. */
  afterPaint?: (paint: () => void) => void;
};

type FirstPaintWindow = Window & { __pubmaxFirstPaint?: boolean };

async function loadSplashPlugin(): Promise<SplashPlugin> {
  const { SplashScreen } = await import("@capacitor/splash-screen");
  return { hide: () => SplashScreen.hide() };
}

// The first rAF runs before the next paint and the second after it, so the
// splash never lifts off a frame the page has not drawn yet.
function afterNextPaint(paint: () => void): void {
  window.requestAnimationFrame(() => window.requestAnimationFrame(paint));
}

/**
 * Hide the launch splash once the page has painted. Returns a cancel for an
 * unmount that comes before the frame; a later call in the same document
 * spends nothing.
 */
export function releaseNativeSplashOnFirstPaint(deps: NativeSplashDeps = {}): () => void {
  const isNative = deps.isNative ?? isNativeApp;
  if (typeof window === "undefined" || !isNative()) return () => {};
  const target = window as FirstPaintWindow;
  if (target.__pubmaxFirstPaint) return () => {};

  let cancelled = false;
  const loadPlugin = deps.loadPlugin ?? loadSplashPlugin;
  (deps.afterPaint ?? afterNextPaint)(() => {
    if (cancelled || target.__pubmaxFirstPaint) return;
    target.__pubmaxFirstPaint = true;
    window.dispatchEvent(new Event(NATIVE_FIRST_PAINT_EVENT));
    // A failed load is silent on purpose: the ceiling still hides the splash.
    Promise.resolve()
      .then(loadPlugin)
      .then((plugin) => plugin.hide())
      .catch(() => undefined);
  });
  return () => {
    cancelled = true;
  };
}
