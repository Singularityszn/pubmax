import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { proofShotPath } from "./helpers/proofShot";
import { storeThemeChoice } from "./helpers/themeClock";

// A signed-out reader opens Summon on a London pub and shares the invite. The
// price comes from the pub's public detail read, and only when its one listed
// row states every fact the line prints. The committed rows state no measure,
// so a fixture adds one to the real detail answer for the priced journeys.

const LAMB = "venue-1yd70c7";
const NOW = new Date("2026-11-17T14:00:00Z");
const SOURCE = "https://www.pint-prices.com/pub/94%20Lamb's%20Conduit%20St,%20London%20WC1N%201EA/The%20Lamb";
const PRICE_LINE = `Pint Prices listed ESTRELLA (pint) at £6.65, read 9 November 2026. Source: ${SOURCE}`;
const CONDITIONS = "£6.65 for CAMRA members showing a card, Monday to Thursday from 5pm until 7pm, not on match days, £1 refundable glass deposit";

type DetailRow = Record<string, unknown>;

/** Serves The Lamb's real detail answer, changed as asked. Answers how many times it has served it. */
async function fixtureLambDetail(page: Page, change: ((row: DetailRow) => void) | null): Promise<() => number> {
  let served = 0;
  await page.route(`**/api/venue/${LAMB}*`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { venue: { prices: DetailRow[] } };
    if (change) change(body.venue.prices[0]!);
    await route.fulfill({ response, json: body });
    served += 1;
  });
  return () => served;
}

function summonDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Summon your mates to The Lamb" });
}

async function openSummon(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.open = () => null;
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-copied", value);
        },
      },
    });
  });
  const response = await page.goto(`/map?sel=${LAMB}`);
  expect(response?.status()).toBe(200);
  const summon = page.getByRole("button", { name: "Summon mates to The Lamb", exact: true });
  const dialog = summonDialog(page);
  // A tap before hydration is dropped, and the dialog's chunk loads on first open.
  await expect(async () => {
    if (await dialog.isVisible()) return;
    const more = page.getByRole("button", { name: "More actions for The Lamb", exact: true });
    if (!(await summon.isVisible()) && await more.isVisible()) await more.click({ timeout: 2_000 });
    await summon.click({ timeout: 2_000 });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  }).toPass();
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await summonDialog(page).screenshot({
    path: proofShotPath(testInfo, `artifacts/summon-dated-price/${name}.png`),
    animations: "disabled",
  });
}

async function copied(page: Page): Promise<string | null> {
  return page.evaluate(() => window.sessionStorage.getItem("pubmax-e2e-copied"));
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("the committed row states no measure, so the invite goes without a price", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "light");
  const served = await fixtureLambDetail(page, null);
  await openSummon(page);
  const dialog = summonDialog(page);

  // The pub's own detail has answered before the invite is built from it.
  await expect.poll(served).toBeGreaterThan(0);
  await dialog.getByRole("button", { name: "Share a link", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Sharing didn't open, so we copied the invite and link.");
  expect(await copied(page)).toBe(
    `Come to The Lamb at 2:30pm? It's on the PUBMAXX map.\nhttp://localhost:${new URL(page.url()).port}/map?sel=${LAMB}&meet=14%3A30`,
  );
  await expect(dialog.locator("[data-summon-preview]")).toHaveCount(0);
  await shot(page, testInfo, "390-light-unmeasured");
});

for (const { width, height, theme } of [
  { width: 390, height: 844, theme: "light" },
  { width: 768, height: 1024, theme: "dark" },
  { width: 1440, height: 900, theme: "light" },
] as const) {
  test(`a stated pint shows its dated source and copies whole at ${width} in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await storeThemeChoice(page, theme);
    await fixtureLambDetail(page, (row) => { row.measure = "pint"; });
    await openSummon(page);
    const dialog = summonDialog(page);

    await expect(dialog.locator("[data-summon-preview]")).toHaveText(`Come to The Lamb at 2:30pm? ${PRICE_LINE}`);
    await shot(page, testInfo, `${width}-${theme}-priced`);
    const share = dialog.getByRole("button", { name: "Share a link", exact: true });
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText("Sharing didn't open, so we copied the invite and link.");
    const text = await copied(page);
    expect(text).toBe(
      `Come to The Lamb at 2:30pm? It's on the PUBMAXX map. ${PRICE_LINE}\nhttp://localhost:${new URL(page.url()).port}/map?sel=${LAMB}&meet=14%3A30`,
    );
    const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a conditional listing is quoted whole at 390 with large text", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "dark");
  await fixtureLambDetail(page, (row) => {
    row.measure = "pint";
    row.price_text = CONDITIONS;
  });
  await openSummon(page);
  await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
  const dialog = summonDialog(page);

  await expect(dialog.locator("[data-summon-preview]")).toContainText(`ESTRELLA (pint) as "${CONDITIONS}", read 9 November 2026.`);
  const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, testInfo, "390-dark-large-conditions");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
