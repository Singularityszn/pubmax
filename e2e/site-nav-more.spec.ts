import { expect, test } from "@playwright/test";
import { storeThemeChoice } from "./helpers/themeClock";

for (const width of [390, 768, 1440]) {
  for (const fontSize of [16, 32]) {
    test.describe(`More at ${width}px with ${fontSize}px text`, () => {
      test.beforeEach(async ({ page, context }) => {
        await page.setViewportSize({ width, height: 900 });
        await storeThemeChoice(page, "light");
        await page.route("**/api/drink-wall?*", (route) => route.fulfill({
          json: { status: "ready", photos: [{ id: "public-photo" }], nextCursor: null },
        }));
        await page.addInitScript(() => {
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        });
        const cdp = await context.newCDPSession(page);
        await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
        await page.goto("/today", { waitUntil: "domcontentloaded" });
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
      });

      test("keeps the final utility readable and clickable above the dock", async ({ page }) => {
        const trigger = page.getByRole("button", { name: "More pages" });
        const menu = page.getByRole("menu", { name: "More pages" });
        await expect(async () => {
          await trigger.click();
          await expect(menu).toBeVisible({ timeout: 1_000 });
        }).toPass();
        await expect(menu.getByRole("menuitem", { name: /^Photos/ })).toBeVisible();
        await menu.evaluate((node) => { node.scrollTop = node.scrollHeight; });
        const theme = menu.getByRole("menuitem", { name: /^Switch to dark theme/ });
        const description = theme.locator(".siteNavMoreDescription");
        const readable = await description.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.bottom - 1);
          return hit !== null && node.contains(hit);
        });
        // A visible description must receive hits rather than the fixed phone dock.
        expect(readable).toBe(true);
        await theme.click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await expect(menu).toHaveCount(0);
        if (width === 390) {
          const plan = page.locator('.mobileTabBar a[href="/plan"]');
          await plan.click({ trial: true });
        }
      });
    });
  }
}

test("More menu stays usable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.route("**/api/drink-wall?*", (route) => route.fulfill({
    json: { status: "ready", photos: [], nextCursor: null },
  }));
  await page.goto("/today");

  const trigger = page.getByRole("button", { name: "More pages" });
  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(async () => {
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass();

  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(312);

  const firstItem = menu.getByRole("menuitem", { name: /^Near/ });
  const lastItem = menu.getByRole("menuitem", { name: /^Switch to (light|dark) theme/ });
  await expect(firstItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(lastItem).toBeFocused();
  await expect(lastItem).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(lastItem).toBeFocused();
});
