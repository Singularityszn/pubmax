import { expect, type Page } from "@playwright/test";

export function mapToolbar(page: Page) {
  return page.locator(".mapToolbar");
}

/** Desktop map toolbar with a live search field — not merely painted server HTML. */
export async function expectMapToolbarReady(
  page: Page,
  timeout = 60_000,
): Promise<void> {
  await expect(mapToolbar(page)).toBeVisible({ timeout });
  await expect(
    mapToolbar(page).getByRole("combobox", { name: "Search pubs" }),
  ).toBeEditable({ timeout });
}

export async function selectFirstToolbarVenue(
  page: Page,
  query: string,
  timeout = 60_000,
): Promise<void> {
  const search = mapToolbar(page).getByRole("combobox", { name: "Search pubs" });
  // Exact, because a role name matches by substring: "Venues across city
  // maps" leads the list, and its first "Soho" row is a Birmingham tavern
  // that opens another city's map.
  const option = page
    .getByRole("group", { name: "Venues", exact: true })
    .getByRole("option")
    .first();
  await expect(async () => {
    await search.click();
    await search.fill(query);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
  await expect(async () => {
    await option.click();
    await expect(page).toHaveURL(/sel=/, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
