import { expect, test } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";

test.use({ storageState: { cookies: [], origins: [] } });

for (const { route, width, height } of [
  { route: "/today", width: 768, height: 1024 },
  { route: "/places", width: 768, height: 1024 },
  { route: "/today", width: 1440, height: 900 },
]) {
  test(`signed-out nav menu is tappable on ${route} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installAuthDoubles(page);
    await page.goto(route);

    const trigger = page.getByRole("button", { name: "Sign in", exact: true }).first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.locator('.siteNavBar .authMenu[aria-label="Sign in options"]');
    const fullPage = menu.getByRole("link", { name: "Open full sign-in page" });
    const email = menu.getByRole("textbox", { name: "Continue with email" });
    await expect(fullPage).toBeInViewport();
    await menu.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished));
    });
    for (const control of [email, fullPage]) {
      await expect.poll(() => control.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        return hit === node || node.contains(hit);
      })).toBe(true);
    }
    if (route === "/today" && width === 768) {
      await page.screenshot({ path: "/tmp/pubmax-signin-menu-after.png" });
    }
    await email.fill("guest@example.test");
    await fullPage.click({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  });
}
