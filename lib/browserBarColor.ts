// The browser bar colour (<meta name="theme-color">), written down once.
//
// The bar matches the page under it (captain decision, 18 Oct 2026): the light
// theme paints the light page floor and the dark theme the dark one. Until then
// both themes painted a near-black bar, so a light page sat under a black strip.
// A PURE LEAF importing nothing. The root layout's viewport reads these values,
// public/manifest.webmanifest repeats the light one, and
// __tests__/browserBarColor.test.ts holds all of them to the page tokens they
// copy, so the bar cannot drift from the page.

export const BROWSER_BAR_COLOR = {
  /** The light page floor: --paper as the DOM paints it (app/globals.css, the light body remap). */
  light: "#f8f2ec",
  /** The dark page floor: --paper under html[data-theme="dark"] (app/theme.css). */
  dark: "#0a0a0b",
} as const;

/** The two theme-color entries the root layout's viewport exports. */
export const BROWSER_BAR_THEME_COLORS = [
  { media: "(prefers-color-scheme: light)", color: BROWSER_BAR_COLOR.light },
  { media: "(prefers-color-scheme: dark)", color: BROWSER_BAR_COLOR.dark },
];
