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

// The shared header and the map Layers sheet use the same saved theme choice.
export default function ThemeToggle({ floating = false }: { floating?: boolean }) {
  const theme = useThemeChoice();
  const label = themeSwitchLabel(theme);

  // React hydration can remove the attribute set before paint. Recover only
  // when no valid theme remains. Write the DOM attribute without setting React
  // state. The shared store observes that write and updates the icon.
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    // Route changes retain the active choice even when storage rejects writes.
    if (current === "light" || current === "dark") return;
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
      {theme === "dark" ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
    </button>
  );
}
