"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function storedTheme(): Theme | null {
  if (typeof localStorage === "undefined") return null;
  const t = localStorage.getItem("pubmax-theme");
  return t === "light" || t === "dark" ? t : null;
}

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  // Prefer the attribute the no-flash script set; fall back to the stored
  // choice so the icon stays correct even if hydration dropped the attribute.
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return storedTheme() ?? "light";
}

export default function ThemeToggle({ floating = false }: { floating?: boolean }) {
  // ponytail: the no-flash script sets html[data-theme] before hydration, so
  // reading it at render is correct on first paint. `bump` just forces a
  // re-render after toggle — no setState in an effect (repo enforces
  // react-hooks/set-state-in-effect as an error).
  const [, bump] = useState(0);
  const theme = currentTheme();
  const goingDark = theme === "light";

  // React 19 hydration can strip the attribute the no-flash script set on
  // <html>, so a reload lands with no data-theme even though the choice is
  // still in localStorage. Re-assert it on mount (DOM write only — not
  // setState — so it doesn't trip react-hooks/set-state-in-effect).
  useEffect(() => {
    const t =
      storedTheme() ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = t;
  }, []);

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
