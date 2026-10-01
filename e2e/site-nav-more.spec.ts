import { expect, test } from "@playwright/test";

const MORE_PAGES = [
  { label: "Drink Wall", href: "/wall" },
  { label: "Near", href: "/near" },
  { label: "Historic", href: "/historic" },
  { label: "Pal", href: "/pal" },
  { label: "Social", href: "/social" },
] as const;

test("More menu stays usable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto("/today");

  const trigger = page.getByRole("button", { name: "More pages" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");

  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Drink WallPints, pubs and London in photos",
    "NearFind priced pubs close to you",
    "HistoricRead the stories behind old pubs",
    "PalAsk for a pub that fits tonight",
    "SocialPub-night posts and crews",
  ]);

  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(312);

  const firstItem = page.getByRole("menuitem", { name: /^Drink Wall/ });
  const lastItem = page.getByRole("menuitem", { name: /Social/ });
  await expect(firstItem).toBeFocused();
  const items = menu.getByRole("menuitem");
  for (const [index, item] of MORE_PAGES.entries()) {
    await expect(items.nth(index)).toHaveAttribute("href", item.href);
    await expect(items.nth(index)).toBeFocused();
    await expect(items.nth(index)).toBeInViewport();
    if (index < MORE_PAGES.length - 1) await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("End");
  await expect(lastItem).toBeFocused();
  await expect(lastItem).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(lastItem).toBeFocused();
});

for (const { label, href } of MORE_PAGES) {
  test(`More menu opens ${label}`, async ({ page }) => {
    await page.goto("/today");
    const trigger = page.getByRole("button", { name: "More pages" });
    const item = page
      .getByRole("menu", { name: "More pages" })
      .getByRole("menuitem", { name: new RegExp(`^${label}\\b`) });
    // A server-painted trigger can receive a click before React attaches.
    await expect(async () => {
      await trigger.click();
      await expect(item).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(item).toHaveAttribute("href", href);
    await item.click();
    await expect(page).toHaveURL(new RegExp(`${href}/?$`));
    await expect(page.getByRole("main")).toHaveCount(1);
  });
}
