"use client";

// Mounted once in the root layout. public/theme-init.js sets html[data-theme]
// before paint, but a route whose server render falls back to the client (every
// segment not-found, such as /crawls/nope, /recap/abc and /plan/nope) gets its
// <html> rebuilt in the browser without that script running. The page then has
// no data-theme at all, so a person in dark sees light tokens (QA journeys
// report F15). ThemeToggle re-asserts the attribute on mount, but those pages
// carry no toggle. This does the same DOM write wherever the attribute is
// missing and renders nothing. It never overrides a theme that is already set.

import { useEffect } from "react";

import { safeLocalStorage } from "@/lib/safeStorage";
import { resolveThemePreference, storedThemePreference } from "@/lib/themePreference";

export default function ThemeAttribute(): null {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === "light" || root.dataset.theme === "dark") return;
    root.dataset.theme = resolveThemePreference(
      storedThemePreference(safeLocalStorage()),
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);

  return null;
}
