// The stored theme choice, written down once.
//
// Three readers used to restate the key and the fallback: public/theme-init.js
// (the no-flash script, a static file that cannot import this module and keeps
// its own copy by design), components/ThemeToggle.tsx and the native shell's
// system-bar bridge. A PURE LEAF importing nothing, so a bundle that needs to
// know the theme pulls no component in behind it.

export const THEME_STORAGE_KEY = "pubmax-theme";

export type ThemePreference = "light" | "dark";

/** The choice the person made with the toggle, or null when they never did. */
export function storedThemePreference(storage: Pick<Storage, "getItem"> | null | undefined): ThemePreference | null {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** The OS appearance, read off the media query the no-flash script reads. */
export function systemThemePreference(matches: boolean): ThemePreference {
  return matches ? "dark" : "light";
}

/**
 * Which theme the document should wear: the person's own choice wins, and
 * only with no choice does the OS decide. This is the one rule theme-init.js
 * applies before paint; the native shell asks it again every time the OS
 * appearance changes while the app is open, because a phone that flips to
 * dark at sunset does so with the app on screen.
 */
export function resolveThemePreference(
  stored: ThemePreference | null,
  systemPrefersDark: boolean,
): ThemePreference {
  return stored ?? systemThemePreference(systemPrefersDark);
}
