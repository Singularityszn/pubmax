import { expect, test, type Page } from "@playwright/test";

import {
  COMMUNITY_SHEET_FIXTURE_MAP_PATH,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";
import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";
import { runnerShotDir } from "./helpers/runnerShotDir";

// An owner's saved venue survives a full load of their own profile.
//
// DEFECT: the owner saved a venue, the API held it and the list page showed it,
// but a full load of /u/<handle> said "No saved venues yet." The profile asked
// for the saves while the session was still restoring. Restoring the session
// aborts every identity-bound request, so the read came back empty, the page
// fell back to the device's local view and nothing asked again.
//
// The keyless Playwright server has no Supabase, so the session and the durable
// saved-pubs store are browser route doubles. The save is the real venue-sheet
// control and the profile is the real page.

const SHOTS = runnerShotDir("pubmax-profile-saved-after-reload");
const LIST = "Want to Visit";
const LOCAL_SAVES_KEY = "pubmax:savedPubs:v1";
const EMPTY_TITLE = "No saved venues yet.";

type SavedRow = {
  venueId: string;
  venueName: string;
  venueMapUrl: string;
  listType: string;
  savedAt: string;
};

/**
 * The durable store, answering only for the owner's handle. A GET is counted
 * per bearer so the test can say the profile read went out signed in.
 */
async function installSavedPubsDouble(
  page: Page,
  rows: SavedRow[] = [],
): Promise<{ signedReads: () => number }> {
  let signedReads = 0;
  await page.route("**/api/saved-pubs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as { venueId?: string; listType?: string };
      const at = rows.findIndex(
        (row) => row.venueId === body.venueId && row.listType === body.listType,
      );
      if (at >= 0) rows.splice(at, 1);
      else if (body.venueId && body.listType) {
        rows.push({
          venueId: body.venueId,
          venueName: COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
          venueMapUrl: `/map?sel=${body.venueId}`,
          listType: body.listType,
          savedAt: new Date().toISOString(),
        });
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: rows }) });
      return;
    }
    if (url.searchParams.get("lists")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lists: [] }) });
      return;
    }
    const owner = url.searchParams.get("handle") === ACCOUNTS.A.handle;
    if (owner && request.headers().authorization) signedReads += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ saved: owner ? rows : [] }),
    });
  });
  return { signedReads: () => signedReads };
}

test.describe("profile saved venues after a full reload", () => {
  test("the owner sees a saved venue on a full load of their profile", async ({ page }) => {
    test.slow();
    await installAuthDoubles(page);
    const store = await installSavedPubsDouble(page);
    // Record whether the empty state ever painted, from the first frame on.
    await page.addInitScript((title) => {
      const flag = "__pubmaxSawEmptySaved";
      (window as unknown as Record<string, boolean>)[flag] = false;
      const look = () => {
        if (document.body?.textContent?.includes(title)) {
          (window as unknown as Record<string, boolean>)[flag] = true;
        }
      };
      new MutationObserver(look).observe(document, { childList: true, subtree: true, characterData: true });
    }, EMPTY_TITLE);

    await seedSignedIn(page, "A");
    await page.goto(COMMUNITY_SHEET_FIXTURE_MAP_PATH);
    await expect
      .poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBe(ACCOUNTS.A.handle);
    // The control reads the device handle when it mounts, so mount it again now
    // that the signed-in identity has written it.
    await page.reload();

    const sheet = page.getByRole("dialog", { name: "Pub detail" });
    await expect(sheet.getByRole("heading", { name: COMMUNITY_SHEET_FIXTURE_VENUE_NAME })).toBeVisible({
      timeout: 30_000,
    });
    await sheet.getByRole("button", { name: `Save ${COMMUNITY_SHEET_FIXTURE_VENUE_NAME} to a list` }).click();
    const [saved] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && new URL(response.url()).pathname === "/api/saved-pubs",
      ),
      sheet
        .getByRole("region", { name: "Save this venue to a list" })
        .getByRole("button", { name: LIST, exact: true })
        .click(),
    ]);
    expect(saved.ok()).toBe(true);

    // The save lives on the server. Drop this device's local copy so only the
    // durable read can put the venue on the profile.
    await page.evaluate((key) => window.localStorage.removeItem(key), LOCAL_SAVES_KEY);

    await page.goto(`/u/${ACCOUNTS.A.handle}#saved-pubs`);
    const row = page
      .locator("#saved-pubs .savedList")
      .filter({ has: page.locator(".savedListName", { hasText: LIST }) })
      .locator(".savedItem", { hasText: COMMUNITY_SHEET_FIXTURE_VENUE_NAME });
    await expect(row).toBeVisible({ timeout: 20_000 });
    expect(store.signedReads(), "the profile read went out with the session").toBeGreaterThan(0);
    expect(
      await page.evaluate(() => (window as unknown as Record<string, boolean>).__pubmaxSawEmptySaved),
      "the empty state never painted before the saves arrived",
    ).toBe(false);
    await page.locator("#saved-pubs").screenshot({ path: `${SHOTS}/profile-saved-after-reload.png` });
  });

  test("a profile whose canonical handle read fails still shows its saved venues", async ({ page }) => {
    test.slow();
    await installAuthDoubles(page);
    const venueId = "venue-e2e-canonical-down";
    const store = await installSavedPubsDouble(page, [
      {
        venueId,
        venueName: COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
        venueMapUrl: `/map?sel=${venueId}`,
        listType: LIST,
        savedAt: new Date().toISOString(),
      },
    ]);
    // The session restores, but the account's handle never comes back, so
    // identity is never settled for the page.
    await page.route("**/api/identity/handle/current", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
    await seedSignedIn(page, "A");

    await page.goto(`/u/${ACCOUNTS.A.handle}#saved-pubs`);
    const row = page
      .locator("#saved-pubs .savedList")
      .filter({ has: page.locator(".savedListName", { hasText: LIST }) })
      .locator(".savedItem", { hasText: COMMUNITY_SHEET_FIXTURE_VENUE_NAME });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#saved-pubs .savedSection")).not.toHaveAttribute("aria-busy", "true");
    expect(store.signedReads(), "the profile read went out with the session").toBeGreaterThan(0);
  });
});
