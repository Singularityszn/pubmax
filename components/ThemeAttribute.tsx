"use client";

// Mounted once in the root layout. The root layout inlines public/theme-init.js
// and sets html[data-theme], html[data-legacy] and html[data-mode] before paint,
// but a client-rendered not-found segment (such as /crawls/nope, /recap/abc or
// /plan/nope) gets its <html> rebuilt in the browser without that script
// running. The page then has none of the three,
// so a person in dark sees light tokens (QA journeys report F15) and a person
// in Legacy Mode or the Ledger view gets standard type and the Lock-In view.
// ThemeToggle re-asserts the theme on mount, but those pages carry no toggle.
// For these three attributes, it repeats theme-init.js only where a value is
// missing. It renders nothing and preserves values that are already set.
//
// It also follows the night theme as the clock passes 21:30 and 04:00 (the
// final effect), and keeps the browser bar on the page's colour. The root
// viewport ships two theme-color tags keyed to the OS scheme, so a reader who
// picks dark in the app on a light phone would see a cream bar over a dark
// page. Whenever html[data-theme] is set or changes, both tags take that
// theme's colour.

import { useEffect } from "react";

import { BROWSER_BAR_COLOR } from "@/lib/browserBarColor";
import { isNativeApp } from "@/lib/nativePlatform";
import { LARGE_TEXT_SCALE_FLOOR, TEXT_SCALE_ATTRIBUTE } from "@/lib/nativeTextScale";
import { safeLocalStorage } from "@/lib/safeStorage";
import {
  isNightThemeTime,
  resolveThemePreference,
  storedThemePreference,
} from "@/lib/themePreference";
import { followStoredThemeChange } from "@/lib/useThemeChoice";
import {
  LEGACY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  modeEnablesLegacy,
  parseMode,
  resolveMode,
} from "@/lib/viewMode";

/** How often the night theme looks at the clock. A minute is the rule's grain. */
const NIGHT_THEME_TICK_MS = 60_000;

function paintBrowserBar(theme: string | undefined): void {
  if (theme !== "light" && theme !== "dark") return;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = BROWSER_BAR_COLOR[theme];
  }
}

function storedValue(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export default function ThemeAttribute(): null {
  // The pre-paint script cannot observe a later browser font change. Refresh
  // its bucket on mount and page resume. The native lifecycle owns shell scale.
  useEffect(() => {
    if (isNativeApp()) return;
    const reconcile = () => {
      const root = document.documentElement;
      const scale = parseFloat(window.getComputedStyle(root).fontSize) / 16;
      if (scale >= LARGE_TEXT_SCALE_FLOOR) root.setAttribute(TEXT_SCALE_ATTRIBUTE, "large");
      else root.removeAttribute(TEXT_SCALE_ATTRIBUTE);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    reconcile();
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const storage = safeLocalStorage();
    if (root.dataset.theme !== "light" && root.dataset.theme !== "dark") {
      root.dataset.theme = resolveThemePreference(
        storedThemePreference(storage),
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
    }
    const storedLegacy = storedValue(storage, LEGACY_STORAGE_KEY);
    if (root.dataset.legacy === undefined && storedLegacy === "1") {
      root.dataset.legacy = "1";
    }
    if (parseMode(root.dataset.mode) === null) {
      const mode = resolveMode(storedValue(storage, MODE_STORAGE_KEY), storedLegacy);
      root.dataset.mode = mode;
      if (modeEnablesLegacy(mode) && root.dataset.legacy === undefined) {
        root.dataset.legacy = "1";
      }
    }

    paintBrowserBar(root.dataset.theme);
    const observer = new MutationObserver(() => paintBrowserBar(root.dataset.theme));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Resume events cover tabs whose minute timer paused. Manual choices take
  // priority, including choices received from other tabs and choices that
  // storage refused. See docs/DESIGN_SYSTEM.md#daynight-coherence.
  useEffect(() => {
    const root = document.documentElement;
    const storage = safeLocalStorage();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (root.dataset.themeChosen === "1" || storedThemePreference(storage) !== null) return;
      const now = new Date();
      const next = resolveThemePreference(null, media.matches, now);
      if (root.dataset.theme !== next) root.dataset.theme = next;
      if (isNightThemeTime(now)) root.dataset.nightTheme = "1";
      else delete root.dataset.nightTheme;
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") follow();
    };
    const onStorage = (event: StorageEvent) => followStoredThemeChange(event.key, event.newValue);
    const timer = window.setInterval(follow, NIGHT_THEME_TICK_MS);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", follow);
    window.addEventListener("focus", follow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", follow);
      window.removeEventListener("focus", follow);
    };
  }, []);

  return null;
}
