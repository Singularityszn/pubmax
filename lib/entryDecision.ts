// The native app opens the public homepage after first-run onboarding.
// Owner amendment, 25 October 2026, replaces the native Tonight launch rule.
// Installed PWAs retain their Tonight start route.
//
// Decision order:
// 1. Explicit non-root links keep their destination.
// 2. A new or unfinished native first run opens onboarding.
// 3. A later root arrival keeps the homepage.
// 4. A returning native launch keeps the homepage, even without session storage.
// 5. A standalone PWA root launch opens Tonight.
// 6. A browser root visit keeps the homepage.
//
// Older native binaries open the root. Newer binaries open /app-entry, whose
// public/theme-init.js script opens onboarding or the root before React loads.
// The session flag also lets a PWA reach Home after its initial entry.
// The pure decision and pre-paint script have separate contract tests.

import type { Route } from "next";
import { readPreferredCity } from "@/lib/cityPreference";
import { ONBOARDING_PATH } from "@/lib/firstRunRoute";
import {
  getNativeFirstRunSnapshot,
  shouldRouteNativeFirstRun,
} from "@/lib/nativeFirstRun";
import { isNativeApp } from "@/lib/nativePlatform";
import { hasConsumedSessionEntry } from "@/lib/sessionEntry";
export {
  SESSION_ENTRY_CONSUMED_KEY,
  hasConsumedSessionEntry,
  markSessionEntryConsumed,
  consumeDeepLinkBootEntry,
} from "@/lib/sessionEntry";

/** PWA launch and native onboarding completion destination. */
export const SHELL_START_PATH = "/tonight";
/** The native shell's first-run surface, resumed until Skip or Plan my night (owner-locked, issue #441).
 *  Held in a leaf so proxy.ts can read the path without this module's imports. */
export { ONBOARDING_PATH };

export type EntryContext = {
  /** Pathname at boot (no query/hash) — "/" is the only decided route. */
  path: string;
  /** Inside the Capacitor native shell (lib/nativePlatform.ts seam). */
  isNativeShell: boolean;
  /** Installed-PWA standalone launch (display-mode / navigator.standalone). */
  isStandaloneDisplay: boolean;
  /**
   * Native first-run per the lib/nativeFirstRun.ts gate (native shell, not
   * finished or skipped, and either an unfinished journey or no persisted
   * city preference). Always false
   * outside the native shell — the gate enforces it, and decideEntry guards
   * it again so a spurious flag can never send a PWA to onboarding.
   */
  isNativeFirstRun: boolean;
  /**
   * Whether this session's cold-start entry decision has already run (owner
   * amendment, 2026-07-21). Snapshotted from hasConsumedSessionEntry(); false
   * on the session's first arrival at "/" (the cold start), true on every later
   * arrival so an in-app home tap reaches the landing page. Fail-safe: reads
   * false when sessionStorage is absent, so we never mistake a cold start for a
   * revisit.
   */
  sessionEntryConsumed: boolean;
};

export type EntryDecision =
  | { kind: "stay"; reason: "deep-link" | "web-default" | "session-revisit" | "native-home" }
  | { kind: "route"; href: Route; reason: "native-first-run" | "shell-cold-start" };

/** Whether this visit runs inside a native shell or an installed PWA. */
export function isAppShell(ctx: Pick<EntryContext, "isNativeShell" | "isStandaloneDisplay">): boolean {
  return ctx.isNativeShell || ctx.isStandaloneDisplay;
}

/**
 * The single entry decision. Pure and total. `firstRunHref` stays injectable
 * for contract tests, while production always uses ONBOARDING_PATH.
 */
export function decideEntry(ctx: EntryContext, firstRunHref: Route = ONBOARDING_PATH): EntryDecision {
  if (ctx.path !== "/") return { kind: "stay", reason: "deep-link" };
  if (ctx.isNativeShell && ctx.isNativeFirstRun) {
    return { kind: "route", href: firstRunHref, reason: "native-first-run" };
  }
  // Owner amendment (2026-07-21): the cold-start decision fires once per
  // session. Once it has run, a later arrival at "/" — the in-app home tap —
  // stays on the landing page, shell or not.
  if (ctx.sessionEntryConsumed) return { kind: "stay", reason: "session-revisit" };
  if (ctx.isNativeShell) return { kind: "stay", reason: "native-home" };
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
    sessionEntryConsumed: hasConsumedSessionEntry(),
  };
}

/** Live first-run target — the dedicated native onboarding route. */
export function entryFirstRunHref(): Route {
  return ONBOARDING_PATH;
}
