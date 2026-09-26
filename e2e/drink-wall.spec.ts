import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("the drink wall page loads and names itself", async ({ page }) => {
  const response = await page.goto("/wall");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Drink Wall", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "All London" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Near me" })).toBeVisible();
});
