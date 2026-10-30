import { expect, test, type Page } from "@playwright/test";

// SUN CHASER, DRIVEN ON A REAL MAP.
//
// The estimate reads building outlines and heights from the basemap's own
// vector tiles, so it can only be proved on a rendered scene (chromium-gl).
// The clock is fixed to a June afternoon so the sun is high and every run asks
// the same question. The spec holds the honesty rules, not a sun verdict: the
// basemap tiles are live, so the pub's answer may be sun, shade or no estimate,
// and each of those must say what it is.

// Lord Raglan (Holborn): a recorded beer garden among tall City buildings.
const GARDEN_PUB_ID = "venue-1qwm0di";
const GARDEN_PUB_NAME = "Lord Raglan (Holborn)";
const SUMMER_AFTERNOON = new Date("2026-06-20T13:10:00Z");
const ARRIVAL_TIMEOUT_MS = 90_000;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

const SHEET_LINE = /^(Sun on the garden until|Garden in shade|After sunset|No sun estimate)/;

async function openFeatureControls(page: Page, phone: boolean) {
  if (phone) {
    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
    await expect(async () => {
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await expect(portal).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: ARRIVAL_TIMEOUT_MS });
    return portal;
  }
  const toolbar = page.locator(".mapToolbar");
  const panel = toolbar.getByRole("dialog", { name: "Filters", exact: true });
  await expect(async () => {
    await toolbar.locator(".mapVenueKindFilterBtn").click();
    await expect(panel).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: ARRIVAL_TIMEOUT_MS });
  return panel;
}

async function closeFeatureControls(page: Page, phone: boolean) {
  await page.keyboard.press("Escape");
  const open = phone
    ? page.locator('.mobileSheetPortal[data-sheet-kind="filters"]')
    : page.locator(".mapToolbar").getByRole("dialog", { name: "Filters", exact: true });
  await expect(open).toBeHidden({ timeout: 10_000 });
}

// Pick the pub after Sun Chaser is on: on a phone the pub sheet holds focus,
// so the Filters door is not reachable while it is open.
async function selectGardenPub(page: Page, phone: boolean) {
  const search = page.locator("#mapSearchInput, #mobileMapSearchInput").first();
  if (phone) {
    const open = page.getByRole("button", { name: "Search the map" });
    await expect(async () => {
      if (!(await search.isVisible())) await open.click();
      await expect(search).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: ARRIVAL_TIMEOUT_MS });
  }
  await search.click();
  await search.fill(GARDEN_PUB_NAME);
  const option = page.getByRole("option", { name: new RegExp(GARDEN_PUB_NAME.replace(/[()]/g, "\\$&")) }).first();
  await expect(async () => {
    await option.click({ timeout: 2_000 });
    await expect(page).toHaveURL(new RegExp(`sel=${GARDEN_PUB_ID}`), { timeout: 2_000 });
  }).toPass({ timeout: ARRIVAL_TIMEOUT_MS });
  await expect(page.getByRole("heading", { name: GARDEN_PUB_NAME })).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });
}

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Sun Chaser marks garden sun honestly at ${viewport.width}x${viewport.height} ${scheme}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const phone = viewport.name === "phone";
      await page.clock.setFixedTime(SUMMER_AFTERNOON);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/map");

      let controls = await openFeatureControls(page, phone);
      const chip = controls.getByRole("button", { name: "Sun Chaser" });
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      await closeFeatureControls(page, phone);

      await selectGardenPub(page, phone);

      // The pub sheet carries the estimate, and an estimate always names itself one.
      const line = page.locator(".sunChaserVenueLine").first();
      await expect(line).toBeAttached({ timeout: ARRIVAL_TIMEOUT_MS });
      const headline = (await line.locator("strong").textContent()) ?? "";
      expect(headline).toMatch(SHEET_LINE);
      if (!headline.startsWith("No sun estimate")) {
        await expect(line).toContainText("estimate from building heights and sun angle, not a weather report");
      }
      await line.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`sun-chaser-sheet-${viewport.name}-${scheme}.png`) });

      await line.screenshot({ path: testInfo.outputPath(`sun-chaser-sheet-line-${viewport.name}-${scheme}.png`) });

      if (phone) await page.getByRole("button", { name: "Close and return to the map" }).click();
      await page.screenshot({ path: testInfo.outputPath(`sun-chaser-map-${viewport.name}-${scheme}.png`) });

      controls = await openFeatureControls(page, phone);
      const status = controls.locator(".sunChaserStatus");
      await status.scrollIntoViewIfNeeded();
      await expect(status).toHaveText(/likely in the sun now|No sun estimate|No recorded gardens/, { timeout: ARRIVAL_TIMEOUT_MS });
      await controls.locator(".sunChaserControls").screenshot({ path: testInfo.outputPath(`sun-chaser-controls-${viewport.name}-${scheme}.png`) });

      // The scrubber moves the question three hours on, and says the time.
      const scrubber = controls.getByRole("slider", { name: /Time/ });
      await scrubber.fill("6");
      await expect(scrubber).toHaveAttribute("aria-valuetext", /^\d\d:\d\d$/);
      if (/likely in the sun/.test((await status.textContent()) ?? "")) {
        await expect(status).toHaveText(/likely in the sun at \d\d:\d\d\./);
        // A future time makes no cloud claim: the feed reads the sky now.
        await expect(status).not.toContainText("now (Open-Meteo)");
      }
      await controls.locator(".sunChaserControls").screenshot({ path: testInfo.outputPath(`sun-chaser-controls-later-${viewport.name}-${scheme}.png`) });
    });
  }
}
