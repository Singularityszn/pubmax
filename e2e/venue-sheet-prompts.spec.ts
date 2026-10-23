import { expect, test } from "@playwright/test";

// Signed out, the venue sheet used to stack its prompts: the list picker stayed
// open under a "Saving..." button and a "Claim a handle" line, and the
// "Set yours" link wore the browser's default blue. One prompt now owns the
// slot at a time and the link uses the launch accent ink.

const VENUE = "/map?sel=venue-eltcmh";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("check-in prompt link uses the launch accent, not browser blue", async ({ page }) => {
  await page.goto(VENUE);
  const link = page.getByRole("link", { name: "Set yours" });
  // The check-in tap does nothing until the auth state resolves, so retry it.
  await expect(async () => {
    await page.getByRole("button", { name: /Mark that you're at/ }).click();
    await expect(link).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const colour = await link.evaluate((el) => getComputedStyle(el).color);
  expect(colour).not.toBe("rgb(0, 0, 238)");
  await expect(link).toHaveClass(/sheetPromptLink/);
});

test("opening a second prompt closes the first", async ({ page }) => {
  await page.goto(VENUE);
  await page.getByRole("button", { name: /to a list/ }).click();
  await expect(page.getByRole("region", { name: "Save this venue to a list" })).toBeVisible();

  // The check-in tap does nothing until the auth state resolves, so retry it.
  await expect(async () => {
    await page.getByRole("button", { name: /Mark that you're at/ }).click();
    await expect(page.getByText("Claim a handle to check in.")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Save this venue to a list" })).toHaveCount(0);

  await page.getByRole("button", { name: /for a night/ }).click();
  await expect(page.getByText("Claim a handle to check in.")).toHaveCount(0);
});

test("the price sign-in prompt folds away when another prompt opens", async ({ page }) => {
  await page.goto(VENUE);
  await page.getByRole("button", { name: /Log (tonight's|a) price|Add a price/i }).first().click();
  await expect(page.getByRole("heading", { name: "Sign in to add a price" })).toBeVisible();

  await page.getByRole("button", { name: /to a list/ }).click();
  await expect(page.getByRole("heading", { name: "Sign in to add a price" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Save this venue to a list" })).toBeVisible();
});
