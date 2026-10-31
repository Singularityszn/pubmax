"use client";

// Mounted once in the root layout. The root layout inlines public/theme-init.js
// and sets html[data-theme], html[data-legacy] and html[data-mode] before paint,
// but a client-rendered not-found segment (such as /crawls/nope, /recap/abc or
// /plan/nope) gets its <html> rebuilt in the browser without that script
// running. The page then has none of the three,
// so a person in dark sees light tokens (QA journeys report F15) and a person
// in Legacy Mode or the Ledger view gets standard type and the Lock-In view.
// ThemeToggle re-asserts the theme on mount, but those pages carry no toggle.
// This makes the same reads and DOM writes as theme-init.js, each only where
// its attribute is missing, and renders nothing. It never overrides a value
// that is already set.
//
// It also follows the night theme as the clock passes 21:30 and 04:00 (the
// second effect), and keeps the browser bar on the page's colour. The root
// viewport ships two theme-color tags keyed to the OS scheme, so a reader who
// picks dark in the app on a light phone would see a cream bar over a dark
// page. Whenever html[data-theme] is set or changes, both tags take that
// theme's colour.

import { useEffect } from "react";

import { BROWSER_BAR_COLOR } from "@/lib/browserBarColor";
import { safeLocalStorage } from "@/lib/safeStorage";
import {
  isNightThemeTime,
  resolveThemePreference,
  storedThemePreference,
} from "@/lib/themePreference";
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

  // THE NIGHT THEME FOLLOWS THE CLOCK WHILE THE PAGE IS OPEN. theme-init.js
  // decides once, before paint; a reader with no theme choice who has Tonight
  // open at 21:29 should see it go dark at 21:30, and light again at 04:00.
  // Asked every minute and whenever the tab comes back (a slept tab's timers
  // do not fire). It stands down for good the moment the reader taps the
  // theme control (html[data-theme-chosen]), even when storage refused to keep
  // that choice, and it never touches a page whose choice is stored.
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
    const timer = window.setInterval(follow, NIGHT_THEME_TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", follow);
    window.addEventListener("focus", follow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", follow);
      window.removeEventListener("focus", follow);
    };
  }, []);

  return null;
}
