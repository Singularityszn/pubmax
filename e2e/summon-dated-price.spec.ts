import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { proofShotPath } from "./helpers/proofShot";
import { storeThemeChoice } from "./helpers/themeClock";

// A signed-out reader opens Summon on a London pub and shares the invite. The
// price comes from the pub's public detail read, and only when its one listed
// row states every fact the line prints. The committed rows state no measure,
// so the priced journeys replace The Lamb's rows with one fixture row. Its date
// and figure are fixed here, so a data refresh cannot move them.

const LAMB = "venue-1yd70c7";
const NOW = new Date("2026-11-17T14:00:00Z");
const SOURCE = "https://www.pint-prices.com/pub/94%20Lamb's%20Conduit%20St,%20London%20WC1N%201EA/The%20Lamb";
const SENTENCE = "Pint Prices listed Fixture Lager (pint) at £5.50, read 10 November 2026.";
const CONDITIONS = "£5.50 for CAMRA members showing a card, Monday to Thursday from 5pm until 7pm, not on match days, £1 refundable glass deposit";

type DetailRow = Record<string, unknown>;

/** The one listed row the priced journeys serve, with every fact stated. */
function fixtureRow(overrides: DetailRow = {}): DetailRow {
  return {
    app_price_id: "app_price_fixture_lamb",
    pint_name: "Fixture Lager",
    measure: "pint",
    price_gbp: 5.5,
    price_text: "£5.50",
    pub_url: SOURCE,
    scraped_at_values: "2026-11-10T12:00:00Z",
    ...overrides,
  };
}

/**
 * Serves The Lamb's real detail answer. With a row, its listed prices become
 * that one row. Answers the rows it served, so a test can wait for the read.
 */
async function fixtureLambDetail(page: Page, row: DetailRow | null): Promise<() => DetailRow[] | null> {
  let served: DetailRow[] | null = null;
  await page.route(`**/api/venue/${LAMB}*`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { venue: { prices: DetailRow[]; cheapestPrice: number | null } };
    if (row) {
      body.venue.prices = [{ ...body.venue.prices[0], ...row }];
      body.venue.cheapestPrice = row.price_gbp as number;
    }
    await route.fulfill({ response, json: body });
    served = body.venue.prices;
  });
  return () => served;
}

function mapLink(page: Page): string {
  return `http://localhost:${new URL(page.url()).port}/map?sel=${LAMB}&meet=14%3A30`;
}

/** The name of the focused element, read the way the accessibility tree reads a button. */
async function focusedName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? null;
  });
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
  await installDeterministicMapBasemap(page);
  const response = await page.goto(`/map?sel=${LAMB}`);
  expect(response?.status()).toBe(200);
  if (page.viewportSize()!.width <= 640) {
    const expand = page.getByRole("button", { name: "Expand sheet", exact: true });
    await expect(expand).toBeVisible();
    await expand.click();
  }
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

  // The pub's own detail has answered, and its real rows state no measure.
  await expect.poll(() => served()?.length ?? 0).toBeGreaterThan(0);
  expect(served()!.every((row) => row.measure == null)).toBe(true);
  await dialog.getByRole("button", { name: "Share a link", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Sharing didn't open, so we copied the invite and link.");
  expect(await copied(page)).toBe(`Come to The Lamb at 2:30pm? It's on the PUBMAXX map.\n${mapLink(page)}`);
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
    await fixtureLambDetail(page, fixtureRow());
    await openSummon(page);
    const dialog = summonDialog(page);

    const preview = dialog.getByRole("group", { name: "Your invite", exact: true });
    await expect(preview).toHaveText(
      `Your invite Come to The Lamb at 2:30pm? It's on the PUBMAXX map: map link ${SENTENCE} Source: Pint Prices`,
      { useInnerText: true },
    );
    await expect(preview.getByRole("link", { name: "Source: Pint Prices", exact: true })).toHaveAttribute("href", SOURCE);
    await expect(preview).not.toContainText("%20");
    await shot(page, testInfo, `${width}-${theme}-priced`);
    const share = dialog.getByRole("button", { name: "Share a link", exact: true });
    await share.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status")).toHaveText("Sharing didn't open, so we copied the invite and link.");
    const text = await copied(page);
    expect(text).toBe(`Come to The Lamb at 2:30pm? It's on the PUBMAXX map: ${mapLink(page)} ${SENTENCE} Source: ${SOURCE}`);
    const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("a conditional listing is quoted whole at 390 with large text", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "dark");
  await fixtureLambDetail(page, fixtureRow({ price_text: CONDITIONS }));
  await openSummon(page);
  await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
  const dialog = summonDialog(page);

  await expect(dialog.locator("[data-summon-preview]")).toContainText(`Fixture Lager (pint) as "${CONDITIONS}", read 10 November 2026.`);
  const overflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, testInfo, "390-dark-large-conditions");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a signed-out reader closes the sign-in gate by keyboard back onto Sign in, then Summon onto its door", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "dark");
  await fixtureLambDetail(page, null);
  await openSummon(page);
  const dialog = summonDialog(page);
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).focus();
  await page.keyboard.press("Enter");
  const gate = page.getByRole("dialog", { name: "Sign in to contribute", exact: true });
  await expect(gate).toBeVisible();
  await expect(gate).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("[data-summon-dialog]")).not.toHaveAttribute("aria-modal", /.*/);
  await page.keyboard.press("Escape");
  await expect(gate).toHaveCount(0);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => focusedName(page)).toBe("Sign in");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("Summon mates to The Lamb");
});

test("a table age check closes back to the unchanged request", async ({ page }) => {
  const auth = await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  auth.setServerHandle("karan");
  await page.route("**/api/summon?*", (route) => route.fulfill({ json: { mates: [] } }));
  await page.route("**/api/table-requests", (route) => route.fulfill({ status: 403, json: { status: "adult_check_required" } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "dark");
  await fixtureLambDetail(page, null);
  await openSummon(page);
  await summonDialog(page).getByRole("button", { name: "Not now", exact: true }).click();
  const more = page.getByRole("button", { name: "More actions for The Lamb", exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByRole("button", { name: "Ask for a table at The Lamb", exact: true }).click();
  const table = page.getByRole("dialog", { name: "Ask The Lamb for a table", exact: true });
  await table.getByLabel("Name the table is under", { exact: true }).fill("Karan Fixture");
  await table.getByLabel("Day", { exact: true }).fill("2026-11-19");
  await table.getByLabel("Time", { exact: true }).fill("20:00");
  await table.getByLabel("Your email", { exact: true }).fill("fixture@example.test");
  await table.getByRole("button", { name: "Send request", exact: true }).focus();
  await page.keyboard.press("Enter");
  const gate = page.getByRole("dialog", { name: "Confirm your age", exact: true });
  await expect(gate).toBeVisible();
  await expect(table).not.toHaveAttribute("aria-modal", /.*/);
  await page.keyboard.press("Escape");
  await expect(gate).toHaveCount(0);
  await expect(table).toHaveAttribute("aria-modal", "true");
  await expect.poll(() => focusedName(page)).toBe("Send request");
  await expect(table.getByLabel("Name the table is under", { exact: true })).toHaveValue("Karan Fixture");
  await expect(table.getByLabel("Day", { exact: true })).toHaveValue("2026-11-19");
  await expect(table.getByLabel("Time", { exact: true })).toHaveValue("20:00");
  await expect(table.getByLabel("Your email", { exact: true })).toHaveValue("fixture@example.test");
  await page.keyboard.press("Escape");
  await expect(table).toHaveCount(0);
  await expect.poll(() => focusedName(page)).toBe("Ask for a table at The Lamb");
});
