import { expect, test, type Page } from "@playwright/test";

import { expectMobileMapShellReady } from "./helpers/mobileMapShell";
import { UI_UX_CHROMIUM_ARGS } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use({ launchOptions: { args: UI_UX_CHROMIUM_ARGS }, serviceWorkers: "block" });

async function settledCamera(page: Page) {
  return page.evaluate(() => {
    const camera = (window as Window & {
      __pubmaxMapCamera?: { read(): {
        center: [number, number]; zoom: number; pitch: number; bearing: number;
        moving: boolean; settling: boolean;
      } };
    }).__pubmaxMapCamera?.read();
    if (!camera || camera.moving || camera.settling) return null;
    const { center, zoom, pitch, bearing } = camera;
    return { center, zoom, pitch, bearing };
  });
}

async function savedViewport(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("map-resume:v2:london:view");
    return raw ? JSON.parse(raw).viewport : null;
  });
}

function expectSameCamera(actual: Awaited<ReturnType<typeof settledCamera>>, expected: NonNullable<Awaited<ReturnType<typeof settledCamera>>>) {
  expect(actual).not.toBeNull();
  expect(actual?.center[0]).toBeCloseTo(expected.center[0], 7);
  expect(actual?.center[1]).toBeCloseTo(expected.center[1], 7);
  expect(actual?.zoom).toBeCloseTo(expected.zoom, 7);
  expect(actual?.pitch).toBeCloseTo(expected.pitch, 7);
  expect(actual?.bearing).toBeCloseTo(expected.bearing, 7);
}

for (const width of [390, 1280]) {
  test(`home price entry resumes the saved camera after a cleared search at ${width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method())
      ? route.continue() : route.abort());
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto("/map?q=Richmond");
    if (width === 390) await expectMobileMapShellReady(page);
    await expect.poll(async () => (await settledCamera(page))?.center[0] ?? 0,
      { timeout: 45_000 }).toBeLessThan(-0.2);
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(page).toHaveURL(/\/map$/);
    await expect.poll(async () => (await savedViewport(page))?.center[0] ?? 0).toBeLessThan(-0.2);
    await expect.poll(() => settledCamera(page)).not.toBeNull();
    const before = await settledCamera(page);
    if (!before) throw new Error("The Richmond camera did not settle.");
    await expect.poll(() => savedViewport(page)).toEqual(before);
    const stored = await savedViewport(page);
    await page.getByRole("link", { name: "Home", exact: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    const door = page.getByRole("link", { name: "Log what you paid", exact: true });
    await expect(async () => {
      await door.click();
      await expect(page).toHaveURL(/\/map\?log=1$/, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.locator(".logIntentFallback:visible")).toBeVisible({ timeout: 45_000 });
    if (width === 390) await expectMobileMapShellReady(page);
    await expect.poll(() => settledCamera(page)).not.toBeNull();
    expectSameCamera(await settledCamera(page), before);
    expectSameCamera(await savedViewport(page), stored);
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(0);
  });

  test(`home price entry chooses a pub before a blank form at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const door = page.getByRole("link", { name: "Log what you paid", exact: true });
    await expect(door).toHaveAttribute("href", "/map?log=1");
    await expect(async () => {
      await door.click();
      await expect(page).toHaveURL(/\/map\?log=1$/, { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    const picker = page.locator(".logIntentFallback:visible");
    await expect(picker).toBeVisible({ timeout: 45_000 });
    await expect(picker.getByRole("button", { name: "Near me", exact: true })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Search pubs", exact: true })).toBeVisible();
    await picker.locator(".logIntentNearbyBtn").first().click();
    await expect(page.locator('input[inputmode="decimal"]')).toHaveValue("");
  });
}
