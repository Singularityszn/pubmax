import { expect, type Locator } from "@playwright/test";

export async function openVenueSecondaryActions(portal: Locator): Promise<Locator> {
  const actions = portal.getByRole("group", { name: "Venue actions", exact: true });
  const more = actions.getByRole("button", { name: /^(?:Hide )?more actions for /i });
  await expect(more).toBeVisible();
  if (await more.getAttribute("aria-expanded") !== "true") await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const secondary = actions.getByRole("group", { name: /^More actions for / });
  await expect(secondary).toBeVisible();
  return secondary;
}
