import { expect, test, type Page } from "@playwright/test";
import { HOW_WE_ESTIMATE_HREF, HOW_WE_ESTIMATE_LABEL, priceStandingLabel } from "@/lib/priceTier";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased, expectMobileMapShellReady } from "./helpers/mobileMapShell";

// B3: the city map must agree with the landing's recorded prices.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await installDeterministicMapBasemap(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
});

async function capture(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function closePub(page: Page) {
  await expect(async () => {
    const close = page.getByRole("button", { name: "Close pub detail", exact: true });
    if (await close.isVisible()) await close.click();
    await expect(page).not.toHaveURL(/[?&]sel=/, { timeout: 1_000 });
    await expect(close).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
}

async function paintedPin(page: Page, id: string, priceGbp?: number) {
  await expect(async () => {
    const pins = await page.evaluate(() => {
      const probe = (window as Window & {
        __pubmaxPaintedMapTapPoints?: { frame: () => Array<{ kind: string; id: string; priceGbp?: number }> };
      }).__pubmaxPaintedMapTapPoints;
      // A painted price does not need every remote basemap tile to finish.
      return probe?.frame() ?? [];
    });
    expect(pins).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "pin", id, ...(priceGbp === undefined ? {} : { priceGbp }) }),
    ]));
  }).toPass({ timeout: 30_000 });
}

test("Manchester landing, pub sheet, pin and cheapest answer agree on the reviewed £3.50 pint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-city="manchester"]');
  await expect(row).toContainText("£3.50");
  await expect(row).toContainText("Listed by Guinndex");
  await expect(row).toContainText("12 April 2026");
  await row.scrollIntoViewIfNeeded();
  await capture(page, "manchester-landing");
  await row.getByRole("link", { name: "The Ford Madox Brown", exact: true }).click();
  await expect(page.getByRole("heading", { name: "The Ford Madox Brown", exact: true })).toBeVisible();
  await expect(page.getByText("Guinness, pint · Listed by Guinndex, recorded 12 April 2026. May have changed since.", { exact: true })).toBeVisible();
  await expectMapLoadingFrameReleased(page);
  await capture(page, "manchester-sourced-sheet");
  await closePub(page);
  await expectMobileMapShellReady(page);
  await paintedPin(page, "venue-mcr-h1zk6u", 3.5);
  await expect(page.getByRole("region", { name: "Cheapest in this view", exact: true })).toContainText("£3.50");
  await expect(page.locator(".cityPubsOnlyNote")).toContainText("Few prices here yet.");
  await capture(page, "manchester-priced-pin-and-cheapest");
});

for (const city of ["bath", "birmingham", "bristol", "cambridge", "durham", "glasgow", "leeds", "liverpool", "llandudno", "oxford"]) {
  test(`${city} map shows sparse coverage and the landing's recorded pint on its pin`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const row = page.locator(`.lpHuntCityRow[data-city="${city}"]`);
    const link = row.locator(".lpHuntCityPub a");
    const example = { city, name: await link.innerText(), href: (await link.getAttribute("href"))!, price: (await row.locator(".lpHuntCityPrice").innerText()).trim() };
    await page.goto(`/map/${city}`, { waitUntil: "domcontentloaded" });
    await expectMapLoadingFrameReleased(page);
    await expect(page.locator(".cityPubsOnlyNote")).toBeVisible();
    await expect(page.locator(".cityPubsOnlyNote")).toContainText("Few prices here yet.");
    const id = new URL(example.href, "http://local").searchParams.get("sel")!;
    const listed = page.locator(`.mapSplitList [data-venue-id="${id}"]`);
    await expect(listed).toContainText(example.price);
    await listed.click();
    await expect(page.getByRole("heading", { name: example.name, exact: true })).toBeVisible();
    await closePub(page);
    await paintedPin(page, id, Number(example.price.replace("£", "")));
    await capture(page, `${city}-priced-pin-and-coverage`);
    await test.info().attach("landing-price-oracle", { body: JSON.stringify(example), contentType: "application/json" });
  });
}

// Since #3103 a pub with no recorded price shows a sampled estimate on purpose.
// The estimate must say it is one everywhere, and must never pass for a recorded price.
test("an unpriced Manchester pub shows a marked estimate, never a recorded price", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/map/manchester", { waitUntil: "domcontentloaded" });
  await expectMapLoadingFrameReleased(page);
  const bank = page.locator('.mapSplitList [data-venue-id]').filter({ hasText: /^The Bank/ });
  await expect(bank).toContainText(/est\. £\d/);
  await expect(bank).toContainText(priceStandingLabel("estimate"));
  const id = (await bank.getAttribute("data-venue-id"))!;
  await bank.click();
  await expect(page.getByRole("heading", { name: "The Bank", exact: true })).toBeVisible();
  await expect(page.getByText("Loading full pub details…", { exact: true })).toHaveCount(0);
  const legend = page.locator("[data-estimate-legend]");
  await expect(legend).toBeVisible();
  await expect(legend.getByRole("link", { name: HOW_WE_ESTIMATE_LABEL, exact: true })).toHaveAttribute("href", HOW_WE_ESTIMATE_HREF);
  // The selected pin always draws. The probe's price is the recorded figure a
  // pin may claim, so an estimate has none.
  await paintedPin(page, id);
  const price = await page.evaluate((venueId) => {
    const probe = (window as Window & { __pubmaxPaintedMapTapPoints?: { frame: () => Array<{ id: string; priceGbp?: number }> } }).__pubmaxPaintedMapTapPoints;
    return probe?.frame().find(pin => pin.id === venueId)?.priceGbp ?? null;
  }, id);
  expect(price).toBeNull();
  await capture(page, "manchester-estimated-pub-sheet-and-pin");
  await closePub(page);
});
