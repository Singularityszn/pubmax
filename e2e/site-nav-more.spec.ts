import { expect, test } from "@playwright/test";

test("More menu stays usable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto("/today");

  await page.getByRole("button", { name: "More", exact: true }).click();

  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "PlanBuild a three-stop night out",
    "NearFind priced pubs close to you",
    "PubsBrowse every listed pub",
    "HistoricRead the stories behind old pubs",
    "PalAsk for a pub that fits tonight",
  ]);

  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(312);

  const firstItem = page.getByRole("menuitem", { name: /Plan/ });
  const lastItem = page.getByRole("menuitem", { name: /Pal/ });
  await firstItem.focus();
  await page.keyboard.press("End");
  await expect(lastItem).toBeFocused();
  await expect(lastItem).toBeInViewport();
});
