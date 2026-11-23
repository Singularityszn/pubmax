import { expect, type Locator, type Page } from "@playwright/test";

export async function openHeaderMore(page: Page): Promise<Locator> {
  const trigger = page.getByRole("navigation", { name: "Site navigation", exact: true })
    .getByRole("button", { name: "More pages", exact: true });
  await expect(trigger).toBeEnabled();
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  const menu = page.getByRole("menu", { name: "More pages", exact: true });
  await expect(menu).toBeVisible();
  return menu;
}

export async function openHeaderThemeControl(page: Page): Promise<Locator> {
  const menu = await openHeaderMore(page);
  const control = menu.getByRole("menuitem", { name: /Switch to (light|dark) theme/ });
  await expect(control).toBeVisible();
  return control;
}
