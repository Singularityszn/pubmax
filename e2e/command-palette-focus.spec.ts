import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
}

test.use({ serviceWorkers: "block" });

for (const width of [1024, 1440]) {
  test.describe(`command palette focus at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const dismissal of ["backdrop", "Escape", "shortcut"] as const) {
      test(`${dismissal} restores the opener after child interaction`, async ({ page }, testInfo) => {
        await prepare(page);
        await page.goto("/places");
        const opener = page.getByRole("button", { name: "Open command palette", exact: true });
        const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
        await expect(async () => {
          await opener.click();
          await expect(palette).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        const search = palette.getByRole("combobox", { name: "Search commands", exact: true });
        await expect(search).toBeFocused();
        await search.click();
        await search.fill("Map");
        await expect(search).toHaveValue("Map");
        await expect(palette).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("01-palette-child-interaction.png") });

        if (dismissal === "backdrop") {
          await page.locator(".cmdkBackdrop").click({ position: { x: 8, y: 8 } });
        } else {
          await search.press(dismissal === "Escape" ? "Escape" : "Control+k");
        }

        await expect(palette).toHaveCount(0);
        await expect(opener).toBeFocused();
        await expect(page).toHaveURL(/\/places$/);
        await page.screenshot({ path: testInfo.outputPath("02-opener-restored.png") });
      });
    }
  });
}

test("backdrop dismissal preserves an existing selected pub", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await page.goto("/map?q=Soho&sel=venue-15i2wst");
  const drawer = page.locator(".mapDrawer.right.springDrawer");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  const opener = drawer.getByRole("button", { name: /Close/ }).first();
  await expect(opener).toBeVisible();
  await opener.focus();
  await expect(opener).toBeFocused();
  await opener.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
  await expect(palette).toBeVisible();
  const search = palette.getByRole("combobox", { name: "Search commands", exact: true });
  await expect(search).toBeFocused();
  await search.click();
  await search.fill("Map");
  await expect(search).toHaveValue("Map");
  await page.locator(".cmdkBackdrop").click({ position: { x: 8, y: 8 } });
  await expect(palette).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(page).toHaveURL(/sel=venue-15i2wst/);
  await page.screenshot({ path: testInfo.outputPath("03-selected-pub-preserved.png") });
});
