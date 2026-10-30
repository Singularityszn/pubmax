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

for (const viewport of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Sun Chaser marks garden sun honestly at ${viewport.width}x${viewport.height} ${scheme}`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const phone = viewport.name === "phone";
      await page.clock.setFixedTime(SUMMER_AFTERNOON);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/map?sel=${GARDEN_PUB_ID}`);
      await expect(page.getByText("Lord Raglan", { exact: false }).first()).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });

      const controls = await openFeatureControls(page, phone);
      const chip = controls.getByRole("button", { name: "Sun Chaser" });
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "true");

      const status = controls.locator(".sunChaserStatus");
      await expect(status).toHaveText(/likely in the sun now|No sun estimate|Zoom in to street level|No recorded gardens/, { timeout: ARRIVAL_TIMEOUT_MS });
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
      await scrubber.fill("0");
      await expect(scrubber).toHaveAttribute("aria-valuetext", "Now");

      await page.keyboard.press("Escape");
      await page.screenshot({ path: testInfo.outputPath(`sun-chaser-map-${viewport.name}-${scheme}.png`) });

      // The pub sheet carries the estimate, and an estimate always names itself one.
      const line = page.locator(".sunChaserVenueLine").first();
      await expect(line).toBeVisible({ timeout: ARRIVAL_TIMEOUT_MS });
      const headline = (await line.locator("strong").textContent()) ?? "";
      expect(headline).toMatch(SHEET_LINE);
      if (!headline.startsWith("No sun estimate")) {
        await expect(line).toContainText("estimate from building heights and sun angle, not a weather report");
      }
      await line.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`sun-chaser-sheet-${viewport.name}-${scheme}.png`) });
    });
  }
}
