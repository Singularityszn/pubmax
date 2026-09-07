import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("declining sign-in returns to the selected pub", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  const destination = "/map?sel=venue-xjf3n0";
  await page.goto(`/login?from=${encodeURIComponent(destination)}`);
  await page.getByRole("link", { name: "Browse without signing in" }).click();
  await expect(page).toHaveURL(new RegExp(`${destination.replace("?", "\\?")}$`));
  await expect(page.getByRole("heading", { name: "Arnos Arms", exact: true })).toBeVisible();
});
