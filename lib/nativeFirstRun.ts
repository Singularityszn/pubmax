// Native-shell first-run routing gate — decides whether the Capacitor app's
// very first launch should skip the web landing page and open the dedicated
// onboarding route. Every later root launch is owned by lib/entryDecision.ts
// and lands on /tonight.
//
// The remote-URL wrap (capacitor.config.ts) always loads the site root, so a
// first-time native user would otherwise land on the marketing page built
// for organic web traffic. We only want that ONE redirect, ONE time, and
// only for a genuinely first-time viewer: if the viewer already has a
// preferred-city choice persisted (lib/cityPreference.ts) they have state —
// either they picked a city on web before installing, or a previous native
// session already ran this redirect and they since chose a city — so we must
// not clobber it or bounce them again.
//
// Storage mirrors the lib/firstRunTour.ts idiom: localStorage-backed,
// SSR-safe, no-op when storage is unavailable. Never routes on the web — the
// isNative flag threaded through shouldRouteNativeFirstRun is sourced from
// isNativeApp() (lib/nativePlatform.ts), the only Capacitor-detection seam.

import { isNativeApp } from "@/lib/nativePlatform";

const STORAGE_KEY = "pubmax:nativeFirstRun:routed:v1";

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export type NativeFirstRunState = {
  /** Native shell only — always false (never route) on web/SSR. */
  isNative: boolean;
  /** This redirect has already run once (this device/install). */
  alreadyRouted: boolean;
  /** Viewer already has a preferred-city choice persisted — has state. */
  hasCityPreference: boolean;
};

/**
 * Pure gate function — exported for unit testing. No storage/DOM access.
 * Routes to onboarding only on a genuinely first native launch with no
 * existing city-preference state, and only once ever.
 */
export function shouldRouteNativeFirstRun(state: NativeFirstRunState): boolean {
  if (!state.isNative) return false;
  if (state.alreadyRouted) return false;
  if (state.hasCityPreference) return false;
  return true;
}

/** Whether the native first-run redirect has already fired on this device. */
export function hasRoutedNativeFirstRun(): boolean {
  if (!hasStorage()) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

/** Persist that the native first-run redirect has fired. No-op on SSR/storage failure. */
export function markNativeFirstRunRouted(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage full / disabled / private mode — degrade silently; worst case
    // is a second no-op check next launch, never a loop (isNativeApp() +
    // hasCityPreference still gate it, and the redirect target is idempotent).
  }
}

/** Clear the flag so the redirect fires again — handy for local testing. */
export function resetNativeFirstRunRouted(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Convenience: read live isNativeApp() alongside the persisted state. */
export function getNativeFirstRunSnapshot(hasCityPreference: boolean): NativeFirstRunState {
  return {
    isNative: isNativeApp(),
    alreadyRouted: hasRoutedNativeFirstRun(),
    hasCityPreference,
  };
}
