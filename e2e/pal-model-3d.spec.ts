import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_PAL_DRAFT, PAL_ONBOARDING_SPECIES } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of [390, 1440]) {
  test(`${width}px: the companion paints a real model and restores its portrait after graphics loss`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/pal");
    const canvas = page.locator('.palModelCanvas[data-model-ready="true"]');
    await expect(canvas).toBeVisible({ timeout: 20_000 });
    const portrait = page.locator(".palPortraitCore");
    await expect(portrait).toHaveCSS("opacity", "0");
    await canvas.scrollIntoViewIfNeeded();
    await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
    await page.screenshot({ path: `artifacts/pubpal-complete-1019/companion-3d-${width}.png` });
    // This is the browser's context-loss extension, not a fabricated UI event.
    await canvas.evaluate((element) => {
      (element as HTMLCanvasElement).getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    });
    await expect(portrait).toHaveCSS("opacity", "1");
    await expect(page.getByRole("img", { name: "Pub Pal", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("reduced motion keeps the still portrait and loads no model canvas", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pal");
  await expect(page.getByRole("button", { name: "Meet your Pub Pal", exact: true })).toBeVisible();
  await expect(page.locator(".palPortraitCore")).toHaveCSS("opacity", "1");
  await expect(page.locator(".palModelCanvas")).toHaveCount(0);
});

for (const width of [390, 1440]) {
  for (const species of PAL_ONBOARDING_SPECIES) {
    test(`${width}px: ${species} paints in the owned companion frame`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const timestamp = "2026-10-04T12:00:00.000Z";
      await installAuthDoubles(page);
      await seedSignedIn(page, "A");
      await page.route("**/api/pub-pal", (route) => route.fulfill({ json: {
        adultOnFile: true,
        pal: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: ACCOUNTS.A.id,
          name: "Model audit", adultAttestedAt: timestamp,
          appearance: { ...DEFAULT_PAL_DRAFT.appearance, species },
          personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
          muted: false, hidden: false, proposalPreferences: { memories: true, routes: true },
          masteryPoints: 0, createdAt: timestamp, updatedAt: timestamp,
        },
      } }));
      await page.route("**/api/pub-pal/memories", (route) => route.fulfill({ json: { memories: [] } }));
      await page.route("**/api/pub-pal/voice-token", (route) => route.fulfill({ json: { available: false } }));
      await page.goto("/pal");
      await expect(page.getByRole("heading", { name: "Model audit", exact: true })).toBeVisible();
      const portrait = page.locator(".palHomePortrait");
      await expect(portrait.locator('.palModelCanvas[data-model-ready="true"]')).toBeVisible();
      await portrait.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await mkdir("artifacts/pubpal-complete-1019", { recursive: true });
      await page.screenshot({ path: `artifacts/pubpal-complete-1019/companion-${species}-${width}.png` });
    });
  }
}
