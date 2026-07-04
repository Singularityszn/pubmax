"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export default function ThemeToggle({ floating = false }: { floating?: boolean }) {
  // ponytail: the no-flash script sets html[data-theme] before hydration, so
  // reading it at render is correct on first paint. `bump` just forces a
  // re-render after toggle — no setState in an effect (repo enforces
  // react-hooks/set-state-in-effect as an error).
  const [, bump] = useState(0);
  const theme = currentTheme();
  const goingDark = theme === "light";

  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("pubmax-theme", next);
    bump((n) => n + 1);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={floating ? "themeToggle floating" : "themeToggle"}
      aria-label={goingDark ? "Switch to dark theme" : "Switch to light theme"}
      title={goingDark ? "Switch to dark theme" : "Switch to light theme"}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
