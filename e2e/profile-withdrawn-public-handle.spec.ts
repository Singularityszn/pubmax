import { expect, test } from "@playwright/test";

test.describe("withdrawn and blocked public profile URLs", () => {
  test("/u/karansdad is a real 404 without a claim prompt", async ({ page }) => {
    const response = await page.goto("/u/karansdad");
    expect(response?.status()).toBe(404);

    await expect(page.getByRole("heading", { name: "Called for last orders here." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim this handle" })).toHaveCount(0);
    await expect(page.getByText("@karansdad")).toHaveCount(0);
  });
});
