// Entry-decision seam — the ONE place that decides which surface the app
// starts on when it boots at the site root ("/"). Owner-locked (issue #439):
// the wrapped app opens on /tonight on every cold start after first-run; the
// landing page is web-only marketing the app never sees.
//
// "App shell" here means either signal, probed through existing seams only:
//   - the Capacitor native wrap (lib/nativePlatform.ts isNativeApp(); the
//     remote-URL wrap in capacitor.config.ts always loads the site root), or
//   - an installed PWA running standalone (display-mode media query or the
//     iOS navigator.standalone flag, same signals lib/a2hsPrompt.ts reads).
//
// Decision precedence (contract-tested in __tests__/entryDecision.test.ts):
//   1. Deep link — any path other than "/" is an explicit destination (share
//      link, push click-through, universal link) and bypasses the decision
//      untouched, shell or not. The decision NEVER rewrites a deep link.
//   2. App shell at the root — a genuine native first-run keeps the existing
//      map-onboarding redirect (lib/nativeFirstRun.ts gate, native shell
//      only); every other shell open lands on /tonight.
//   3. Web default — a browser visit keeps the marketing landing page.
//
// The decision is a pure function of an explicit context snapshot so it unit
// tests in the node vitest env; the thin live probes at the bottom are the
// only globals readers, mirroring the lib/a2hsPrompt.ts snapshot idiom.

import { preferredCityMapHref, readPreferredCity } from "@/lib/cityPreference";
import {
  getNativeFirstRunSnapshot,
  shouldRouteNativeFirstRun,
} from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";

/** Where every post-first-run shell open lands (owner-locked, issue #439). */
export const SHELL_START_PATH = "/tonight";

export type EntryContext = {
  /** Pathname at boot (no query/hash) — "/" is the only decided route. */
  path: string;
  /** Inside the Capacitor native shell (lib/nativePlatform.ts seam). */
  isNativeShell: boolean;
  /** Installed-PWA standalone launch (display-mode / navigator.standalone). */
  isStandaloneDisplay: boolean;
  /**
   * Genuine native first-run per the lib/nativeFirstRun.ts gate (native
   * shell, never routed before, no persisted city preference). Always false
   * outside the native shell — the gate enforces it, and decideEntry guards
   * it again so a spurious flag can never send a PWA to map onboarding.
   */
  isNativeFirstRun: boolean;
};

export type EntryDecision =
  | { kind: "stay"; reason: "deep-link" | "web-default" }
  | { kind: "route"; href: string; reason: "native-first-run" | "shell-cold-start" };

/** Either app-shell signal — the surfaces that must never see the landing page. */
export function isAppShell(ctx: Pick<EntryContext, "isNativeShell" | "isStandaloneDisplay">): boolean {
  return ctx.isNativeShell || ctx.isStandaloneDisplay;
}

/**
 * The single entry decision. Pure and total. `firstRunHref` is the map
 * onboarding target for a genuine native first-run (callers pass
 * preferredCityMapHref(); the gate guarantees no city preference exists in
 * that branch, so it resolves to "/map").
 */
export function decideEntry(ctx: EntryContext, firstRunHref: string = "/map"): EntryDecision {
  if (ctx.path !== "/") return { kind: "stay", reason: "deep-link" };
  if (ctx.isNativeShell && ctx.isNativeFirstRun) {
    return { kind: "route", href: firstRunHref, reason: "native-first-run" };
  }
  if (isAppShell(ctx)) {
    return { kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" };
  }
  return { kind: "stay", reason: "web-default" };
}

// ---------------------------------------------------------------------------
// Live probes (client only; every export above stays DOM-free)
// ---------------------------------------------------------------------------

/**
 * Installed-PWA standalone launch probe. SSR-safe (false on the server).
 * Reads the same two signals lib/a2hsPrompt.ts snapshots: the display-mode
 * media query (Android/desktop installs) and navigator.standalone (iOS
 * home-screen installs, which never match the media query on older WebKit).
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    // matchMedia missing/throwing — fall through to the iOS flag.
  }
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

/** Snapshot the live entry context for the given boot pathname. */
export function readEntryContext(path: string): EntryContext {
  return {
    path,
    isNativeShell: isNativeApp(),
    isStandaloneDisplay: isStandaloneDisplay(),
    isNativeFirstRun: shouldRouteNativeFirstRun(
      getNativeFirstRunSnapshot(readPreferredCity() !== null),
    ),
  };
}

/** Live first-run target — the existing map-onboarding href. */
export function entryFirstRunHref(): string {
  return preferredCityMapHref();
}
