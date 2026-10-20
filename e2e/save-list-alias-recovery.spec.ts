import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { desktopVenueDrawer, expectSoleDesktopDrawer } from "@/e2e/helpers/mapSurfaceDrawers";

const STORAGE_KEY = "pubmax:savedPubs:v1";
const SEEDED_MARKER = "pubmax:e2e:save-list-alias-recovery-seeded";
const BLACKFRIAR_ID = "venue-eltcmh";
const BLACKFRIAR_NAME = "The Blackfriar";
const LIST = "Want to Visit";
const SAVED_RAW = JSON.stringify([
  { venueId: "venue-1sw9ofl", listType: LIST, note: "Friday route", savedAt: "2026-10-04T12:00:00.000Z" },
]);

test.use({ serviceWorkers: "block", viewport: { width: 1440, height: 900 } });

async function seed(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, value, marker }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
      if (window.sessionStorage.getItem(marker) === "1") return;
      window.sessionStorage.setItem(marker, "1");
      window.localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: SAVED_RAW, marker: SEEDED_MARKER },
  );
}

async function savedBytes(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

async function failAliasReadsUntilReleased(page: Page): Promise<() => void> {
  let failing = true;
  await page.route("**/data/venue_id_aliases.json", (route) =>
    failing ? route.abort("failed") : route.continue(),
  );
  return () => {
    failing = false;
  };
}

type SavePressRecord = {
  before: string;
  after: string | null;
  chipPressed: string | null;
  status: string | null;
  statusVisible: boolean;
};

async function recordAfterPress(
  testInfo: TestInfo,
  picker: Locator,
  name: string,
  assertions: (record: SavePressRecord) => Promise<void>,
): Promise<void> {
  let record: SavePressRecord | null = null;
  try {
    await expect(async () => {
      // Capture the short-lived announcement and saved state in one browser turn.
      const snapshot = await picker.evaluate((region, { key, before, list }) => {
        const status = region.querySelector<HTMLElement>('[role="status"]');
        const chip = [...region.querySelectorAll('button[aria-pressed]')].find((button) =>
          button.textContent?.replace(/^✓/, "").trim() === list,
        );
        return {
          before,
          after: window.localStorage.getItem(key),
          chipPressed: chip?.getAttribute("aria-pressed") ?? null,
          status: status?.textContent ?? null,
          statusVisible: Boolean(status && status.getBoundingClientRect().height > 0 &&
            getComputedStyle(status).visibility !== "hidden"),
        };
      }, { key: STORAGE_KEY, before: SAVED_RAW, list: LIST });
      record = snapshot;
      expect(snapshot.statusVisible).toBe(true);
      await assertions(snapshot);
    }).toPass({ timeout: 20_000 });
  } finally {
    await mkdir(testInfo.outputDir, { recursive: true });
    const recordPath = testInfo.outputPath(`${name}-storage.json`);
    await writeFile(recordPath, JSON.stringify(record, null, 2));
    await testInfo.attach(`${name}-storage`, { path: recordPath, contentType: "application/json" });
    const path = testInfo.outputPath(`${name}.png`);
    await picker.screenshot({ path, animations: "disabled" });
    await testInfo.attach(name, { path, contentType: "image/png" });
  }
}

async function openPickerAfterFailedAliasRead(page: Page) {
  const response = await page.goto(`/map?sel=${BLACKFRIAR_ID}`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expectSoleDesktopDrawer(page, "venue");
  const drawer = desktopVenueDrawer(page);
  await expect(drawer.getByRole("heading", { name: BLACKFRIAR_NAME })).toBeInViewport({ timeout: 30_000 });
  const picker = drawer.getByRole("region", { name: "Save this venue to a list" });
  await expect(async () => {
    await drawer.getByRole("button", { name: `Save ${BLACKFRIAR_NAME} to a list` }).click();
    await expect(picker).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const chip = picker.getByRole("button", { name: /^✓?Want to Visit$/ });
  await expect(chip).toBeEnabled({ timeout: 20_000 });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(await savedBytes(page)).toBe(SAVED_RAW);
  return { picker, chip, status: picker.getByRole("status") };
}

test("an explicit save after the alias lookup recovers keeps the old save and its note", async ({ page }, testInfo) => {
  test.slow();
  await seed(page);
  const release = await failAliasReadsUntilReleased(page);
  const { picker, chip, status } = await openPickerAfterFailedAliasRead(page);

  release();
  await chip.click();
  await recordAfterPress(testInfo, picker, "recovered-chip-save", async (record) => {
    expect(record.after).toBe(SAVED_RAW);
    expect(record.chipPressed).toBe("true");
    expect(record.status).toBe(`Saved to "${LIST}" on this device`);
  });

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await expect(status).toHaveText(`Removed from "${LIST}"`);
  expect(await savedBytes(page)).toBe("[]");

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText(`Saved to "${LIST}" on this device`);
  await expect
    .poll(async () => JSON.parse((await savedBytes(page)) ?? "null"))
    .toEqual([{ venueId: BLACKFRIAR_ID, listType: LIST, savedAt: expect.any(String) }]);
});

test("Create & save after the alias lookup recovers keeps the old save and its note", async ({ page }, testInfo) => {
  test.slow();
  await seed(page);
  const release = await failAliasReadsUntilReleased(page);
  const { picker, chip, status } = await openPickerAfterFailedAliasRead(page);
  const name = picker.getByRole("textbox", { name: "New list name" });
  const create = picker.getByRole("button", { name: "Create & save" });

  release();
  await name.fill(LIST);
  await create.click();
  await recordAfterPress(testInfo, picker, "recovered-create-save", async (record) => {
    expect(record.after).toBe(SAVED_RAW);
    expect(record.chipPressed).toBe("true");
    expect(record.status).toBe(`Saved to "${LIST}" on this device`);
  });

  await name.fill(LIST);
  await create.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText(`Saved to "${LIST}" on this device`);
  expect(await savedBytes(page)).toBe(SAVED_RAW);
});
