import { expect, type Page } from "@playwright/test";

/** Dismiss optional introductions through visible controls, without seeding state. */
export async function dismissMapIntroductions(page: Page): Promise<void> {
  const controls = [
    page.getByRole("button", { name: "Skip the tour", exact: true }),
    page.locator(".mapOnboarding").getByRole("button", { name: "Close", exact: true }),
    page.getByRole("complementary", { name: "Anonymous analytics choice" })
      .getByRole("button", { name: "No thanks", exact: true }),
  ];
  // Close the owned drawer before its ambient arrival card.
  if ((await page.locator(".mapDrawer.springDrawer.open").count()) === 0) {
    controls.push(page.getByRole("complementary", { name: "First visit" })
      .getByRole("button", { name: "Close", exact: true }));
  }
  for (const control of controls) {
    if (!(await control.isVisible())) continue;
    await expect(async () => {
      if (await control.isVisible()) await control.click();
      await expect(control).not.toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  }
}
