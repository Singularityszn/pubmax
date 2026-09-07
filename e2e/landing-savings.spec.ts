import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await installAuthDoubles(page);
  await page.route("**/api/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  }));
  await seedSignedIn(page, "A");
});

test("landing savings exclude halves and other measures", async ({ page }) => {
  await page.route("**/api/pint-drops?author=*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ drops: [
      { priceGbp: 1, measure: "pint" },
      { priceGbp: 1, measure: "half" },
      { priceGbp: 1, measure: "other" },
    ] }),
  }));
  await page.goto("/");
  await expect(page.locator(".lpSaved[data-mine]")).toContainText("over 1 pint you logged");
});

test("signing out removes the account's landing savings", async ({ page }) => {
  await page.route("**/api/pint-drops?author=*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ drops: [{ priceGbp: 1, measure: "pint" }] }),
  }));
  await page.goto("/");
  await expect(page.locator(".lpSaved[data-mine]")).toBeVisible();
  await page.getByRole("button", { name: /Account options/ }).first().click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".lpSaved[data-mine]")).toHaveCount(0);
  await expect(page.locator(".lpSaved")).toContainText("The average listed pint");
});
