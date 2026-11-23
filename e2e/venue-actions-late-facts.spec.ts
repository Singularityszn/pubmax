import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";

const VENUE_ID = "venue-eltcmh";
const VENUE_NAME = "The Blackfriar";
const LIST = "Want to Visit";
const STORAGE_KEY = "pubmax:savedPubs:v1";

test.use({ serviceWorkers: "block", reducedMotion: "reduce" });

type SavedRow = { venueId: string; venueName: string; venueMapUrl: string; listType: string; savedAt: string };

// Saving to a list needs an account. The keyless server has no Supabase, so the
// durable saved-pubs store is a browser route double.
async function installSavedPubsDouble(page: Page): Promise<void> {
  const rows: SavedRow[] = [];
  await page.route("**/api/saved-pubs**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = (request.postDataJSON() ?? {}) as { action?: string; venueId?: string; listType?: string };
      // The list is built in, so the store registers no custom list for it.
      if (body.action === "createList") {
        await route.fulfill({ json: { lists: [] } });
        return;
      }
      if (body.venueId && body.listType) {
        rows.push({ venueId: body.venueId, venueName: VENUE_NAME, venueMapUrl: `/map?sel=${body.venueId}`,
          listType: body.listType, savedAt: new Date().toISOString() });
      }
      await route.fulfill({ json: { saved: rows } });
      return;
    }
    if (new URL(request.url()).searchParams.get("lists")) {
      await route.fulfill({ json: { lists: [] } });
      return;
    }
    await route.fulfill({ json: { saved: rows } });
  });
}

for (const width of [1440, 390]) {
  test(`a late area comparison keeps Create & save under the pointer at ${width}px`, async ({ page }, testInfo) => {
    test.slow();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.addInitScript(({ key }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
      window.localStorage.setItem(key, "[]");
    }, { key: STORAGE_KEY });
    await installAuthDoubles(page);
    await installSavedPubsDouble(page);
    await seedSignedIn(page, "A");
    // The session restores on the next load. The save control reads the
    // handle when it mounts, so the gated load below starts signed in.
    await page.goto(`/map?sel=${VENUE_ID}`, { waitUntil: "domcontentloaded" });
    await expect.poll(async () => (await readDeviceIdentity(page)).handle, { timeout: 15_000 })
      .toBe(ACCOUNTS.A.handle);

    let releaseComparison!: () => void;
    const comparisonGate = new Promise<void>((resolve) => { releaseComparison = resolve; });
    await page.route("**/data/pint_index_snapshot.json", async (route) => {
      await comparisonGate;
      await route.continue();
    });
    let pointerHeld = false;
    try {
      const response = await page.goto(`/map?sel=${VENUE_ID}`, { waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      const surface = width === 390
        ? page.locator('.mobileSheetPortal[data-sheet-kind="venue"]')
        : page.locator(".mapDrawer.right.springDrawer");
      await expect(surface).toBeVisible();
      if (width === 390) {
        await surface.getByRole("tab", { name: "Prices", exact: true }).click();
        await expect(surface.locator(".mobileSharedSheet")).toHaveClass(/sheet-half/);
        await surface.getByRole("tab", { name: "Overview", exact: true }).click();
      }
      await surface.getByText("Your record", { exact: true }).click();
      const picker = surface.getByRole("region", { name: "Save this venue to a list" });
      await surface.getByRole("button", { name: `Save ${VENUE_NAME} to a list`, exact: true }).click();
      await expect(picker).toBeVisible();
      // The chips wait for the account's saved lists. A press before they land is not a save.
      await expect(picker.getByRole("button", { name: LIST, exact: true })).toBeEnabled();
      await picker.getByRole("textbox", { name: "New list name" }).fill(LIST);
      const create = picker.getByRole("button", { name: "Create & save", exact: true });
      await create.click({ trial: true });
      const before = await create.boundingBox();
      if (!before) throw new Error("Create & save has no painted box");
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      pointerHeld = true;
      releaseComparison();
      // The real line, not the hidden sample that holds its room.
      await expect(surface.getByRole("status").filter({ hasText: /here\.|About average for/ }))
        .toBeVisible({ timeout: 30_000 });
      const after = await create.boundingBox();
      await page.mouse.up();
      pointerHeld = false;
      await testInfo.attach("comparison-arrival-geometry", {
        body: JSON.stringify({ before, after }), contentType: "application/json",
      });
      await expect(picker.getByRole("button", { name: /^✓?Want to Visit$/ }))
        .toHaveAttribute("aria-pressed", "true");
      await expect(picker.getByRole("textbox", { name: "New list name" })).toHaveValue("");
      expect(after).not.toBeNull();
      expect(Math.abs((after?.y ?? Number.NaN) - before.y)).toBeLessThanOrEqual(1);
      await expect.poll(() => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), STORAGE_KEY))
        .toEqual([{ venueId: VENUE_ID, listType: LIST, savedAt: expect.any(String) }]);
      await page.screenshot({ path: testInfo.outputPath(`late-comparison-${width}.png`) });
    } finally {
      releaseComparison();
      if (pointerHeld) await page.mouse.up();
    }
  });
}
