import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { mockTonightListings } from "./helpers/tonightListings";

const SHOTS_DIR = "docs/screenshots/tonight-vibe-chips";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

for (const [label, width] of [
  ["390", 390],
  ["1280", 1280],
] as const) {
  for (const state of ["ready", "empty"] as const) {
    test(`tonight vibe chips use sentence case when ${state} @${label}`, async ({ page }) => {
      test.setTimeout(60_000);
      mkdirSync(SHOTS_DIR, { recursive: true });
      await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });

      await mockTonightListings(page, state);
      await page.goto("/tonight", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("tonight-screen")).toHaveAttribute("data-listings-status", state);
      const vibes = page.getByRole("group", { name: "What’s the vibe tonight", exact: true });
      const vibe = vibes.locator(".vibeChip").first();
      await expect(vibe).toBeVisible({ timeout: 30_000 });

      // `none` and not merely "not uppercase": app/globals.css declares the same
      // class with `text-transform: lowercase`, so the label's own sentence case
      // only survives while the shared skin states none.
      const skin = await vibe.evaluate((el) => {
        const style = getComputedStyle(el);
        return { textTransform: style.textTransform, fontFamily: style.fontFamily };
      });
      expect(skin.textTransform).toBe("none");

      // Bungee draws cap-height glyphs only, so a chip on the party face reads as
      // ALL CAPS to the reader however text-transform computes. The label face is
      // the display one.
      expect(skin.fontFamily).not.toMatch(/bungee/i);
      // next/font renames the family (`__Space_Grotesk_<hash>`), so match the
      // face rather than the literal two-word name.
      expect(skin.fontFamily).toMatch(/grotesk/i);

      // The 44px floor is the chip's own geometry and is not the casing's to move.
      const box = await vibe.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      // The chips sit well below one phone viewport on /tonight, and toBeVisible
      // only asserts a non-empty box, so a viewport shot taken where the page
      // landed would be evidence of everything except the chips.
      await vibe.scrollIntoViewIfNeeded();
      await expect(vibe).toBeInViewport();
      await page.screenshot({
        path: `${SHOTS_DIR}/tonight-vibe-${state}-${label}.png`,
        fullPage: false,
      });
      if (state === "ready") {
        const music = vibes.getByRole("button", { name: "Live and loud", exact: true });
        await music.click();
        await expect(music).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId("tonight-list").locator(".tonightRowTitle")).toHaveText(["Live Jazz"]);
      } else {
        const quiet = vibes.getByRole("link", { name: "Quiet pint", exact: true });
        await expect(quiet).toHaveAttribute("href", "/plan?occasion=quiet&src=tonight-vibes");
        await quiet.focus();
        await expect(quiet).toBeFocused();
        await expect(quiet).toBeInViewport();
        await expect(vibes.getByRole("button", { name: "Live and loud", exact: true })).toHaveCount(0);
      }
    });
  }

  test(`tonight keeps the retry door when vibe data is unavailable @${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await mockTonightListings(page, "degraded");
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("tonight-screen")).toHaveAttribute("data-picks-state", "temporarily_unavailable");
    await expect(page.getByRole("button", { name: "Retry listings", exact: true })).toBeVisible();
    await expect(page.locator(".vibeChip")).toHaveCount(0);
    await expect(page.getByText(/having a quiet one tonight/i)).toHaveCount(0);
  });
}
