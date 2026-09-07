"use client";

import { useEffect } from "react";

import { isNativeApp } from "@/lib/nativePlatform";
import { syncNativeSystemBars, type NativeTheme } from "@/lib/nativeSystemBars";
import { resolveThemePreference, storedThemePreference } from "@/lib/themePreference";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function activeTheme(): NativeTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * Native-only, renderless bridge with two jobs.
 *
 * 1. The system bars follow the document's theme, so a light page gets dark
 *    status-bar glyphs and a dark page gets light ones.
 * 2. THE DOCUMENT FOLLOWS THE OS WHILE THE APP IS OPEN. public/theme-init.js
 *    decides the theme once, before paint, and nothing re-asked afterwards, so
 *    a phone that flipped to dark at sunset with the app on screen (or in the
 *    background, which iOS resumes without a reload) kept a light page under
 *    a light status bar until the next cold start. That is a web habit; a
 *    native app changes with the switch. The rule is the same one theme-init
 *    applies: a stored choice wins, and only with no choice does the OS
 *    decide (lib/themePreference.ts). Measured on the iPhone 17 Pro simulator:
 *    docs/proof/mobile-app-design/ios-sim-iphone17pro/tonight/.
 */
export default function NativeSystemBars(): null {
  useEffect(() => {
    if (!isNativeApp()) return;

    const apply = () => void syncNativeSystemBars(activeTheme());
    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const media = window.matchMedia?.(SYSTEM_DARK_QUERY);
    const followSystem = () => {
      let storage: Storage | null = null;
      try {
        storage = window.localStorage;
      } catch {
        storage = null;
      }
      const next = resolveThemePreference(storedThemePreference(storage), media?.matches === true);
      if (document.documentElement.dataset.theme !== next) {
        document.documentElement.dataset.theme = next;
      }
    };
    media?.addEventListener?.("change", followSystem);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", followSystem);
    };
  }, []);

  return null;
}
