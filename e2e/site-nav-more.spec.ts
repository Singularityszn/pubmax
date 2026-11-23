import { expect, test } from "@playwright/test";

test("More menu stays usable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 320 });
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

  // Photos leads the menu only while the public wall has a photo
  // (components/nav/SiteNavMore.tsx), and the keyless wall is empty.
  const firstItem = menu.getByRole("menuitem").first();
  const lastItem = menu.getByRole("menuitem", { name: /^Pal/ });
  await expect(firstItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(lastItem).toBeFocused();
  await expect(lastItem).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(lastItem).toBeFocused();
});
