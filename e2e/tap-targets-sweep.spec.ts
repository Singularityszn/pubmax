import { expect, test, type Page } from "@playwright/test";

// The signed-out sweep measured controls under the 44px floor at 390px:
// Historic borough links (324x19), Drink Wall chips (28 to 30px), the Places
// search input (26px), the Spoons value pub links (15px, 790 of them) and the
// "Run this pub?" trigger on a ledger page (97x24).

const FLOOR = 44;

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectTall(page: Page, selector: string, limit = 12): Promise<void> {
  const heights = await page
    .locator(selector)
    .evaluateAll(
      (nodes, cap) =>
        nodes
          .filter((node) => (node as HTMLElement).offsetParent !== null)
          .slice(0, cap)
          .map((node) => Math.round(node.getBoundingClientRect().height)),
      limit,
    );
  expect(heights.length, `${selector} is on the page`).toBeGreaterThan(0);
  for (const height of heights) expect(height, selector).toBeGreaterThanOrEqual(FLOOR);
}

test("Historic borough links are 44px tall", async ({ page }) => {
  await page.goto("/historic");
  await expectTall(page, ".historicBoroughLink");
});

test("Drink Wall chips and scope buttons are 44px tall", async ({ page }) => {
  await page.goto("/wall");
  await expectTall(page, ".drinkWallTag");
  await expectTall(page, ".drinkWallScope button");
});

test("the Places search input fills its 48px field", async ({ page }) => {
  await page.goto("/places");
  await expectTall(page, ".placesSearchInput");
});

test("Spoons value pub links are 44px tall without stretching the row", async ({ page }) => {
  await page.goto("/spoons-value");
  await expectTall(page, ".spoonsTablePub a");
  // The negative margin returns the layout height: a row stays a row.
  const rowHeight = await page
    .locator(".spoonsTable tbody tr")
    .first()
    .evaluate((row) => row.getBoundingClientRect().height);
  expect(rowHeight).toBeLessThan(140);
});

test("the ledger masthead link and Run this pub trigger are 44px tall", async ({ page }) => {
  await page.goto("/ledger/venue-eltcmh");
  await expectTall(page, ".ledgerHomeLink");
  await expectTall(page, ".operatorRailTrigger");
});
