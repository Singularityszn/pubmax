"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";

import { resolveThemePreference } from "@/lib/themePreference";
import {
  storedThemeChoice,
  themeSwitchLabel,
  toggleThemeChoice,
  useThemeChoice,
} from "@/lib/useThemeChoice";

// The icon toggle. It no longer rides the primary header (Oct 2026 UX audit):
// the theme is a setting, so the desktop More menu and the You page's
// Appearance block offer it in words, and this icon stays where the map's
// Layers sheet already groups "Map appearance". All three read and write
// through lib/useThemeChoice.ts.
export default function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const theme = useThemeChoice();
  const label = themeSwitchLabel(theme);

  // React 19 hydration can strip the attribute the no-flash script set on
  // <html>, so a reload lands with no data-theme even though the choice is
  // still in localStorage. Re-assert it on mount (DOM write only — not
  // setState — so it doesn't trip react-hooks/set-state-in-effect). The
  // MutationObserver in the shared store then re-reads it, so the icon
  // resolves too.
  useEffect(() => {
    document.documentElement.dataset.theme = resolveThemePreference(
      storedThemeChoice(),
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);

  return (
    <button
      type="button"
      onClick={toggleThemeChoice}
      className={floating ? "themeToggle floating" : "themeToggle"}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
