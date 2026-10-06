"use client";

// Mounted once in the root layout. public/theme-init.js sets html[data-theme],
// html[data-legacy] and html[data-mode] before paint, but a route whose server
// render falls back to the client (every segment not-found, such as
// /crawls/nope, /recap/abc and /plan/nope) gets its <html> rebuilt in the
// browser without that script running. The page then has none of the three,
// so a person in dark sees light tokens (QA journeys report F15) and a person
// in Legacy Mode or the Ledger view gets standard type and the Lock-In view.
// ThemeToggle re-asserts the theme on mount, but those pages carry no toggle.
// This makes the same reads and DOM writes as theme-init.js, each only where
// its attribute is missing, and renders nothing. It never overrides a value
// that is already set.

import { useEffect } from "react";

import { safeLocalStorage } from "@/lib/safeStorage";
import { resolveThemePreference, storedThemePreference } from "@/lib/themePreference";
import {
  LEGACY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  modeEnablesLegacy,
  parseMode,
  resolveMode,
} from "@/lib/viewMode";

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
  }, []);

  return null;
}
