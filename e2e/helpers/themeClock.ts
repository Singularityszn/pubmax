import type { BrowserContext, Page } from "@playwright/test";

// With no stored theme the app is dark from 21:30 to 04:00 London time
// (docs/DESIGN_SYSTEM.md, "Day/night coherence"), so a spec that leaves the
// theme to the default passes by day and fails when CI runs at night.

/** Stores the theme a spec means, as a reader's own choice would. */
export async function storeThemeChoice(target: Page | BrowserContext, theme: "light" | "dark"): Promise<void> {
  await target.addInitScript((choice) => window.localStorage.setItem("pubmax-theme", choice), theme);
}

/**
 * Holds the browser clock at a London afternoon, for a spec that checks the
 * default itself (the device setting decides by day) and so cannot store one.
 * Call it before the first navigation.
 */
export async function holdLondonAfternoon(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-10-30T14:00:00Z"));
}
