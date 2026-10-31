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
function systemThemePreference(matches: boolean): ThemePreference {
  return matches ? "dark" : "light";
}

/** London 21:30, in minutes after midnight: the night theme starts. */
export const NIGHT_THEME_STARTS_MINUTES = 21 * 60 + 30;
/** London 04:00: the night theme ends. */
export const NIGHT_THEME_ENDS_MINUTES = 4 * 60;
const NIGHT_THEME_TIME_ZONE = "Europe/London";

/**
 * Whether London's clock is in the night theme's hours, 21:30 to 03:59. A
 * product for a night out in London is read in the dark, so a reader who has
 * not chosen a theme gets the dark one then (docs/DESIGN_SYSTEM.md,
 * "Day/night coherence"). public/theme-init.js keeps its own copy of these
 * two numbers, because it runs before any module, and
 * __tests__/themeNight.test.ts holds the two copies together.
 */
export function isNightThemeTime(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: NIGHT_THEME_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  return minutes >= NIGHT_THEME_STARTS_MINUTES || minutes < NIGHT_THEME_ENDS_MINUTES;
}

/**
 * Which theme the document should wear: the person's own choice wins; with no
 * choice, London's night (21:30 to 04:00) is dark; otherwise the OS decides.
 * This is the one rule theme-init.js applies before paint; the native shell
 * asks it again every time the OS appearance changes while the app is open,
 * and ThemeAttribute asks it again as the clock passes 21:30 and 04:00.
 */
export function resolveThemePreference(
  stored: ThemePreference | null,
  systemPrefersDark: boolean,
  now: Date = new Date(),
): ThemePreference {
  if (stored) return stored;
  if (isNightThemeTime(now)) return "dark";
  return systemThemePreference(systemPrefersDark);
}
