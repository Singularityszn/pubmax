import { expect, test, type Page } from "@playwright/test";

// The signed-out sweep measured controls under the 44px floor at 390px:
// Historic borough links (324x19), Drink Wall chips (28 to 30px), the Places
// search input (26px), the Spoons value pub links (15px, 790 of them), the
// "Run this pub?" trigger on a ledger page (97x24) and the About page's
// inline and list links (16px).

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

test("About inline and list links are 44px tall", async ({ page }) => {
  await page.goto("/about");
  // Half the links live inside disclosures; open all three so every one is measured.
  await page
    .locator("details.aboutDisclosure")
    .evaluateAll((all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await expectTall(page, "main#main .aboutLink", 20);
  for (const link of await page.locator("main#main .aboutLink").all()) {
    await link.scrollIntoViewIfNeeded();
    const interceptedRows = await link.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const missed: number[] = [];
      for (let offset = 1; offset < rect.height; offset += 1) {
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + offset);
        if (!hit || !node.contains(hit)) missed.push(offset);
      }
      return missed;
    });
    expect(interceptedRows, await link.getAttribute("href") ?? "About link").toEqual([]);
  }

  const licenceUrl = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";
  await page.context().route(licenceUrl, (route) => route.fulfill({
    contentType: "text/html",
    body: "<title>Open Government Licence</title>",
  }));
  const licence = page.locator(`a.aboutLink[href="${licenceUrl}"]`);
  await licence.scrollIntoViewIfNeeded();
  const box = await licence.boundingBox();
  expect(box).not.toBeNull();
  const popupPromise = page.waitForEvent("popup");
  await licence.click({ position: { x: box!.width / 2, y: box!.height - 1 } });
  const popup = await popupPromise;
  await expect(popup).toHaveURL(licenceUrl);
  await popup.close();
});

test("the ledger masthead link and Run this pub trigger are 44px tall", async ({ page }) => {
  await page.goto("/ledger/venue-eltcmh");
  await expectTall(page, ".ledgerHomeLink");
  await expectTall(page, ".operatorRailTrigger");
});
