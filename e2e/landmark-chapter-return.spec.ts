import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`${width}px: a chapter reopens its landmark after a warm map visit`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/map?landmark=big-ben");
    await expect(page.getByRole("heading", { name: "Big Ben", exact: true })).toBeVisible();
    await page.getByRole("status", { name: "Loading the London pub map.", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("link", { name: "Open chapter", exact: true }).click();
    await expect(page).toHaveURL(/\/landmark\/big-ben$/);
    await page.getByRole("link", { name: "Open on the map", exact: true }).click();
    await expect(page).toHaveURL(/\/map\?landmark=big-ben$/);
    await expect(page.getByRole("heading", { name: "Big Ben", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open chapter", exact: true })).toBeVisible();
  });
}
