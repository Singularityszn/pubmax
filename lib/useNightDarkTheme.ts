"use client";

// Last orders is dark at night by default. While `active` is true (the Last
// orders list is open, or its map filter is on, between 21:30 and 04:00 London
// time) the page wears the dark theme, through the same html[data-theme] the
// theme toggle writes, so every token, the map style and the browser bar
// follow it (docs/DESIGN_SYSTEM.md, "Day/night coherence").
//
// THE READER'S OWN CHOICE ALWAYS WINS. With a stored theme choice nothing is
// touched. Nothing is stored either: this is a default for a moment, not a
// choice made for the reader. When the moment ends (the list closes, the
// filter goes off, 04:00 arrives) the page goes back to what it wore before,
// unless the reader picked a theme in the meantime, which then stands.
//
// html[data-night-theme] marks a page that is dark because of this rule, so a
// test or a stylesheet can tell it apart from a chosen dark theme.

import { useEffect } from "react";

import { storedThemeChoice } from "@/lib/useThemeChoice";

export function useNightDarkTheme(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (storedThemeChoice() !== null) return;
    const root = document.documentElement;
    const before = root.dataset.theme;
    if (before === "dark") return;
    root.dataset.theme = "dark";
    root.dataset.nightTheme = "1";
    return () => {
      delete root.dataset.nightTheme;
      if (storedThemeChoice() !== null) return;
      if (root.dataset.theme !== "dark") return;
      if (before === "light" || before === "dark") root.dataset.theme = before;
      else delete root.dataset.theme;
    };
  }, [active]);
}
