import { expect, test, type Locator, type Page } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

import { openHeaderMore, openHeaderThemeControl } from "./helpers/headerThemeControl";

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should meet the 44px tap target`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, `${label} should not horizontally overflow`).toBeLessThanOrEqual(1);
}

test.describe("site navigation touch targets", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("keeps dense tablet navigation links and utilities thumb-safe", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/pubs");

    const nav = page.getByRole("navigation", { name: "Site navigation" });
    await expect(nav).toBeVisible();
    await expectTappable(nav.getByLabel("Open PUBMAXX landing page"), "tablet site wordmark");
    await expectTappable(nav.getByRole("link", { name: "Explore", exact: true }), "tablet Map link");
    await expectTappable(nav.getByRole("link", { name: "Plan", exact: true }), "tablet Plan link");
    await expectTappable(nav.getByRole("link", { name: "Tonight", exact: true }), "tablet Tonight link");
    await expectTappable(nav.getByRole("link", { name: "You", exact: true }), "tablet You link");
    // Signed-out visitors retain the theme control without bell or messages.
    await expect(nav.getByLabel(/^Activity/)).toHaveCount(0);
    await expect(nav.getByLabel(/^Messages/)).toHaveCount(0);
    await expectTappable(await openHeaderThemeControl(page), "tablet theme menu item");
    await page.keyboard.press("Escape");
    await expectTappable(nav.getByRole("button", { name: "More pages" }), "tablet More menu");
    const signIn = nav.getByRole("button", { name: "Sign in" });
    if ((await signIn.count()) > 0) {
      await expectTappable(signIn, "tablet sign-in trigger");
    }
    await expectNoHorizontalOverflow(page, "tablet site nav");
  });

  test("keeps every landing route reachable by keyboard with large text", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAuthDoubles(page);
    await storeThemeChoice(page, "light");
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.fontSize = "32px";
    }));
    await seedSignedIn(page, "A");
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Account options for/ })).toBeInViewport({ ratio: 1 });
    const links = page.getByRole("navigation", { name: "Site navigation" }).locator(".siteNavLinks").getByRole("link");
    await links.first().focus();
    const count = await links.count();
    for (let index = 1; index < count; index += 1) await page.keyboard.press("Tab");
    await expect(links.last()).toBeFocused();
    await expect(links.last()).toBeInViewport({ ratio: 1 });
  });

  test("keeps the command-palette affordance large enough when it is visible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pubs");

    await expectTappable(
      (await openHeaderMore(page)).getByRole("menuitem", { name: /^Search/ }),
      "command palette trigger",
    );
    await expectNoHorizontalOverflow(page, "desktop-small site nav");
  });
});
