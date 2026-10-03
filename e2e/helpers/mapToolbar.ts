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

/** Venue search needs the slim index; retry when the map surfaces a load failure. */
async function dismissVenueIndexRetryIfPresent(page: Page): Promise<void> {
  const retry = page
    .getByRole("status")
    .filter({ hasText: /pub list/i })
    .getByRole("button", { name: "Retry" });
  if (!(await retry.isVisible().catch(() => false))) return;
  await retry.click();
  await expect(page.getByText(/pub list (hasn't|still hasn't) loaded/i)).toHaveCount(0, {
    timeout: 60_000,
  });
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
    mapToolbar(page).getByRole("combobox", { name: "Search places" }),
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
  const search = mapToolbar(page).getByRole("combobox", { name: "Search places" });
  // Exact group names only: "Venues across city maps" is a different lane whose
  // first "Soho" row can be a Birmingham tavern that opens another city's map.
  await waitForVenueIndexReady(page, timeout);
  // Suggestions render from a deferred query, which a loaded runner can hold for
  // seconds. Wait on the venue row itself; refilling the same text keeps the
  // query, whereas picking an Area clears it and restarts that render.
  await expect(async () => {
    await dismissVenueIndexRetryIfPresent(page);
    await search.click();
    await search.fill(query);
    await expect(mapVenueSuggestionGroup(page).getByRole("option").first()).toBeVisible({
      timeout: 15_000,
    });
  }).toPass({ timeout });
  await expect(async () => {
    const option = mapVenueSuggestionGroup(page).getByRole("option").first();
    await option.click();
    await expect(page).toHaveURL(/sel=/, { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}
