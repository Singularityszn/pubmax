import { expect, type Page } from "@playwright/test";

import { UK_BASE_SEARCH_GROUP_LABEL } from "@/lib/ukBasePubSearch";

export function mapToolbar(page: Page) {
  return page.locator(".mapToolbar");
}

/** Curated rows use the Venues group; resident base pubs use Pubs on the map. */
function mapVenueSuggestionGroup(page: Page) {
  return page
    .getByRole("group", { name: "Venues", exact: true })
    .or(page.getByRole("group", { name: UK_BASE_SEARCH_GROUP_LABEL, exact: true }));
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
  const venueOption = mapVenueSuggestionGroup(page).getByRole("option").first();
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
  // Exact group names only: "Venues across city maps" is a different lane whose
  // first "Soho" row can be a Birmingham tavern that opens another city's map.
  const option = mapVenueSuggestionGroup(page).getByRole("option").first();
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
