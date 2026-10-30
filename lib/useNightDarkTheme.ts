"use client";

// Last orders is dark at night by default. While `active` is true (the Last
// orders list is open, or its map filter is on, between 21:30 and 04:00 London
// time) the page wears the dark theme, through the same html[data-theme] the
// theme toggle writes, so every token, the map style and the browser bar
// follow it (docs/DESIGN_SYSTEM.md, "Day/night coherence").
//
// THE READER'S OWN CHOICE ALWAYS WINS. With a stored theme choice nothing is
// touched, and the moment anything else changes the theme while it is dark
// (the theme control, even when storage refuses to keep the choice), the page
// is the reader's and nothing is restored. Nothing is stored either: this is
// a default for a moment, not a choice made for the reader. When the moment
// ends (the list closes, the filter goes off, 04:00 arrives) the page goes
// back to what it wore before, unless the reader picked a theme in the
// meantime, which then stands.
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
    // The page is ours only until anything else touches its theme. A tap on
    // the theme control is a choice even when storage refuses to keep it
    // (toggleThemeChoice still writes the attribute), so the first change we
    // did not make releases the page for good and nothing is restored.
    let released = false;
    const observer = new MutationObserver(() => {
      if (released) return;
      released = true;
      delete root.dataset.nightTheme;
      observer.disconnect();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      // A change still queued for the observer counts too. Read it before
      // disconnecting, which would throw the queued records away.
      if (observer.takeRecords().length > 0) released = true;
      observer.disconnect();
      delete root.dataset.nightTheme;
      if (released) return;
      if (storedThemeChoice() !== null) return;
      if (root.dataset.theme !== "dark") return;
      if (before === "light" || before === "dark") root.dataset.theme = before;
      else delete root.dataset.theme;
    };
  }, [active]);
}
