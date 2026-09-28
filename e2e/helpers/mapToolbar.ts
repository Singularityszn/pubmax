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

async function focusAreaForQuery(page: Page, query: string): Promise<void> {
  const areaOption = page
    .getByRole("group", { name: "Areas", exact: true })
    .getByRole("option", { name: new RegExp(query, "i") })
    .first();
  if (!(await areaOption.isVisible().catch(() => false))) return;
  await areaOption.evaluate((node) => (node as HTMLElement).click());
}

/** Type an area query and pan the map when venue rows are not indexed yet. */
export async function applyToolbarAreaQuery(
  page: Page,
  query: string,
  timeout = 120_000,
): Promise<void> {
  const search = mapToolbar(page).getByRole("combobox", { name: "Search pubs" });
  const venueOption = page
    .getByRole("group", { name: "Venues", exact: true })
    .getByRole("option")
    .first();
  await expect(async () => {
    await search.click();
    await search.fill(query);
    if (!(await venueOption.isVisible().catch(() => false))) {
      await focusAreaForQuery(page, query);
      await search.click();
      await search.fill(query);
    }
    await expect(venueOption).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
}

export async function selectFirstToolbarVenue(
  page: Page,
  query: string,
  timeout = 120_000,
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
    if (!(await option.isVisible().catch(() => false))) {
      await focusAreaForQuery(page, query);
      await search.click();
      await search.fill(query);
    }
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
  await expect(async () => {
    await option.evaluate((node) => (node as HTMLElement).click());
    await expect(page).toHaveURL(/sel=/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}
