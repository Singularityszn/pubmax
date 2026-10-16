"use client";

// The one reading and the one write of the light/dark choice, shared by every
// control that offers it: the icon toggle (components/ThemeToggle.tsx, kept on
// the map's Layers sheet), the desktop More menu's theme row (SiteNav) and the
// Appearance setting on the You page. The theme left the primary header in the
// Oct 2026 UX audit; living here keeps the three doors to it one mechanism.

import { useSyncExternalStore } from "react";

import { safeLocalStorage } from "@/lib/safeStorage";
import {
  THEME_STORAGE_KEY,
  storedThemePreference,
  type ThemePreference,
} from "@/lib/themePreference";

export function storedThemeChoice(): ThemePreference | null {
  return storedThemePreference(safeLocalStorage());
}

function domTheme(): ThemePreference {
  if (typeof document === "undefined") return "light";
  // Prefer the attribute the no-flash script set; fall back to the stored
  // choice so the control stays correct even if hydration dropped the attribute.
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return storedThemeChoice() ?? "light";
}

// useSyncExternalStore reads the theme without a hydration mismatch: the SERVER
// snapshot (and therefore the FIRST client render) is a deterministic "light",
// so server HTML === first client HTML (no #418). After hydration commits, the
// store re-reads the real theme from html[data-theme] and re-renders, and a
// MutationObserver keeps every control in sync when the theme is toggled or
// changed in another tab. No setState-in-effect (repo enforces that as an error).
function subscribe(onChange: () => void): () => void {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", onChange);
  return () => {
    mo.disconnect();
    window.removeEventListener("storage", onChange);
  };
}

export function useThemeChoice(): ThemePreference {
  return useSyncExternalStore(subscribe, domTheme, () => "light");
}

/** Flip light and dark: the attribute on <html>, then the stored choice. */
export function toggleThemeChoice(): void {
  const next: ThemePreference = domTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    safeLocalStorage()?.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Site data blocked: the attribute still flips for this view.
  }
}

/** What a control that flips the theme says it will do. */
export function themeSwitchLabel(theme: ThemePreference): string {
  return theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}
