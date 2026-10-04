import { expect, type Page } from "@playwright/test";

import { UK_BASE_SEARCH_GROUP_LABEL } from "@/lib/ukBasePubSearch";

export function mapToolbar(page: Page) {
  return page.locator(".mapToolbar");
}

function searchSuggestionsListbox(page: Page) {
  return page.getByRole("listbox", { name: "Search suggestions" });
}

/** Curated rows use the Venues group; resident base pubs use Pubs on the map. */
function mapVenueSuggestionGroup(page: Page) {
  return searchSuggestionsListbox(page)
    .getByRole("group", { name: "Venues", exact: true })
    .or(
      searchSuggestionsListbox(page).getByRole("group", {
        name: UK_BASE_SEARCH_GROUP_LABEL,
        exact: true,
      }),
    );
}

/**
 * Venue search needs the slim index; retry when the map surfaces a load failure.
 * Returns whether Retry was clicked. That click blurs the search combobox.
 */
async function dismissVenueIndexRetryIfPresent(page: Page): Promise<boolean> {
  const retry = page
    .getByRole("status")
    .filter({ hasText: /pub list/i })
    .getByRole("button", { name: "Retry" });
  if (!(await retry.isVisible().catch(() => false))) return false;
  await retry.click();
  await expect(page.getByText(/pub list (hasn't|still hasn't) loaded/i)).toHaveCount(0, {
    timeout: 60_000,
  });
  return true;
}

async function waitForVenueIndexReady(page: Page, timeout = 60_000): Promise<void> {
  await expect(async () => {
    await dismissVenueIndexRetryIfPresent(page);
    const pending = page.getByText("Fetching the pub list…");
    if (await pending.isVisible().catch(() => false)) {
      await expect(pending).toHaveCount(0, { timeout: 5_000 });
    }
  }).toPass({ timeout });
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
  await expect(async () => {
    await dismissVenueIndexRetryIfPresent(page);
  }).toPass({ timeout });
}

export async function selectFirstToolbarVenue(
  page: Page,
  query: string,
  timeout = 60_000,
): Promise<void> {
  const search = mapToolbar(page).getByRole("combobox", { name: "Search pubs" });
  // Exact group names only: "Venues across city maps" is a different lane whose
  // first "Soho" row can be a Birmingham tavern that opens another city's map.
  await waitForVenueIndexReady(page, timeout);
  // Suggestions follow an 80ms debounce. Fill once and wait for the venue row:
  // filling again restarts that debounce and the search-index fetch, so a loaded
  // runner can spend the whole budget restarting work that was about to paint.
  // Picking an Area would clear the query, so this wait stays on the venue row.
  const option = mapVenueSuggestionGroup(page).getByRole("option").first();
  await search.click();
  await search.fill(query);
  await expect(async () => {
    // Retry sits on the map, so the click blurs the combobox and the suggestion
    // list unmounts. Focus the field again. The query is already there; filling
    // again would restart the debounce.
    if (await dismissVenueIndexRetryIfPresent(page)) {
      await search.click();
    }
    await expect(option).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout });
  await expect(async () => {
    const option = mapVenueSuggestionGroup(page).getByRole("option").first();
    await option.click();
    await expect(page).toHaveURL(/sel=/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}
