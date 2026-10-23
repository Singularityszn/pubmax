import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

for (const theme of ["light", "dark"] as const) {
  test(`You keeps cached profiles separate from the signed-out account in ${theme} theme`, async ({ page }, testInfo) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("pubmax-theme", selectedTheme);
      localStorage.setItem("pubmax_handle", "karan");
      localStorage.setItem("pubmax_account_owner", "previous-account");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    await page.route((url) => url.pathname === "/api/profiles/karan", async (route) => {
      await route.fulfill({
        json: {
          profile: {
            id: "11111111-1111-4111-8111-111111111111",
            handle: "karan",
            displayName: "Karan Manoharan",
            bio: "I love art, music and food",
            createdAt: "2026-08-01T12:00:00.000Z",
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
          socialLinks: [],
        },
      });
    });

    await page.goto("/u/karan");
    await expect(page.locator(".profileHandle")).toContainText("@karan");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const publicScreenshot = testInfo.outputPath(`public-profile-${theme}.png`);
    await page.screenshot({ path: publicScreenshot });
    await testInfo.attach("public-profile", { path: publicScreenshot, contentType: "image/png" });
    const you = page.getByRole("navigation", { name: "Primary", exact: true })
      .getByRole("link", { name: "You", exact: true });
    await expect(you).toHaveAttribute("href", "/u/you");
    await expect(async () => {
      await you.click();
      await expect(page.getByRole("heading", { name: "Claim your @handle.", exact: true }))
        .toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/u\/you$/);
    await expect(page.locator(".profileHandle")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to follow", exact: true })).toHaveCount(0);
    const screenshotPath = testInfo.outputPath(`signed-out-you-${theme}.png`);
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach("signed-out-you", { path: screenshotPath, contentType: "image/png" });

    await page.goto("/u/karan");
    await expect(page.locator(".profileHandle")).toContainText("@karan");
    await expect(page).toHaveURL(/\/u\/karan$/);
  });
}
